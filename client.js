/**
 * @local/dsh-voice-duplex — Client half.
 *
 * A full-duplex voice panel in the root-scoped frame overlay:
 *  - continuous microphone capture with acoustic VAD and 16 kHz downsampling;
 *  - local SenseVoice ASR through the Host;
 *  - a separate background voice-chat API call, with its own memory;
 *  - only model-classified work instructions are submitted to the current DSH session;
 *  - assistant text polling and sentence-level Breeze TTS;
 *  - barge-in: speaking while the assistant talks stops audio immediately.
 *
 * No keyword routing happens here. The background DeepSeek API call decides
 * chat vs work, and the DSH agent remains the authority for tools and task
 * control once a work instruction is submitted.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-voice-duplex',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/dsh-voice'
    const SAMPLE_RATE = 16000

    // Voice UI lives in the root-scoped shell.overlay, so its media graph and
    // active call survive conversation switches. This tiny store carries the
    // *current* session context from the per-session composer bridge.
    const voiceContext = { sessionId: '', inputActions: undefined }
    const voiceContextListeners = new Set()
    function publishVoiceContext(next) {
      if (voiceContext.sessionId === next.sessionId && voiceContext.inputActions === next.inputActions) return
      voiceContext.sessionId = next.sessionId
      voiceContext.inputActions = next.inputActions
      for (const listener of voiceContextListeners) listener({ ...voiceContext })
    }
    function useVoiceContext() {
      const [value, setValue] = useState({ ...voiceContext })
      useEffect(() => {
        voiceContextListeners.add(setValue)
        setValue({ ...voiceContext })
        return () => { voiceContextListeners.delete(setValue) }
      }, [])
      return value
    }
    function VoiceContextBridge({ sessionId, inputActions }) {
      useEffect(() => {
        publishVoiceContext({
          sessionId: String(sessionId || ''),
          inputActions,
        })
      }, [sessionId, inputActions])
      return null
    }

    // ------------------------------------------------------------------
    // Transport
    // ------------------------------------------------------------------

    async function getJson(path) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store' })
      let data
      try { data = await response.json() } catch { data = undefined }
      if (!response.ok || !data || data.ok === false) {
        throw new Error(data && data.error ? data.error : `HTTP ${response.status}`)
      }
      return data
    }

    async function postJson(path, body, signal) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      let data
      try { data = await response.json() } catch { data = undefined }
      if (!response.ok || !data || data.ok === false) {
        throw new Error(data && data.error ? data.error : `HTTP ${response.status}`)
      }
      return data
    }

    async function putJson(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      let data
      try { data = await response.json() } catch { data = undefined }
      if (!response.ok || !data || data.ok === false) {
        throw new Error(data && data.error ? data.error : `HTTP ${response.status}`)
      }
      return data
    }

    // ------------------------------------------------------------------
    // Speech text
    // ------------------------------------------------------------------

    function stripParenthetical(text) {
      let value = String(text || '')
      // Remove action/role-play asides. Repeat for nested parentheses.
      for (let pass = 0; pass < 8; pass += 1) {
        const next = value
          .replace(/（[^（）]*）/g, ' ')
          .replace(/\([^()]*\)/g, ' ')
          .replace(/【[^【】]*】/g, ' ')
          .replace(/\[[^\[\]]*\]/g, ' ')
          .replace(/〔[^〔〕]*〕/g, ' ')
        if (next === value) break
        value = next
      }
      return value
    }

    function jsonObjectCandidate(raw) {
      const source = String(raw || '')
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
      const start = source.indexOf('{')
      if (start < 0) return ''
      let depth = 0
      let inString = false
      let escaped = false
      for (let index = start; index < source.length; index += 1) {
        const char = source[index]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') inString = true
        else if (char === '{') depth += 1
        else if (char === '}') {
          depth -= 1
          if (depth === 0) return source.slice(start, index + 1)
        }
      }
      return ''
    }

    function decodeJsonString(raw) {
      try { return JSON.parse(`"${raw}"`) } catch {
        return String(raw || '')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '')
          .replace(/\\t/g, ' ')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      }
    }

    function speechText(input) {
      if (input && typeof input === 'object') {
        if (typeof input.reply === 'string') return input.reply
        if (typeof input.text === 'string') return input.text
        return ''
      }
      const raw = String(input || '')
      const candidate = jsonObjectCandidate(raw)
      if (candidate) {
        try {
          const parsed = JSON.parse(candidate)
          if (typeof parsed.reply === 'string') return parsed.reply
          if (parsed.reply && typeof parsed.reply.text === 'string') return parsed.reply.text
        } catch {
          // Fall through to named-field recovery.
        }
      }
      if (/"(?:mode|reply|voice_direction|instruction|deep)"\s*:/.test(raw) || /^\s*[{[]/.test(raw)) {
        const match = raw.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/)
        return match ? decodeJsonString(match[1]) : ''
      }
      return raw
    }

    function stripForSpeech(text) {
      const withoutMarkup = String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/~~~[\s\S]*?~~~/g, ' ')
        .replace(/`([^`\n]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      return stripParenthetical(withoutMarkup)
        .replace(/^\s*["'“”‘’]?(?:reply|回复|台词|语音文本|播报文本|播报内容)\s*["'“”‘’]?\s*[:：]\s*["'“”‘’]?/gim, '')
        .replace(/^\s*["'“”‘’]?(?:mode|voice_direction|instruction|deep)\s*["'“”‘’]?\s*[:：].*$/gim, ' ')
        .replace(/"(?:mode|reply|voice_direction|instruction|deep)"\s*:\s*/gi, ' ')
        .replace(/^\s*[{}[\],]+\s*$/gm, ' ')
        .replace(/<(https?:\/\/[^>\s]+)>/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s{0,3}[-*+]\s+/gm, '')
        .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
        .replace(/[*_~]{1,3}/g, '')
        .replace(/\|/g, ' ')
        .replace(/\r/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
        .trim()
    }
    // Test seam: no runtime behavior changes, only exposes the pure cleaner.
    if (typeof window !== 'undefined') {
      window.__dshVoiceStripForSpeech = stripForSpeech
      window.__dshVoiceSpeechText = speechText
      window.__dshVoiceIsBreezeBusy = isBreezeBusy
    }

    function splitSpeech(text) {
      const sentences = []
      let current = ''
      for (const char of String(text || '')) {
        current += char
        const hard = '。！？!?；;…\n'.includes(char)
        const soft = current.length >= 90 && '，,、'.includes(char)
        const long = current.length >= 140
        if (hard || soft || long) {
          const value = current.trim()
          if (value.replace(/[\s。！？!?；;…，,、]/g, '').length >= 2) sentences.push(value)
          current = ''
        }
      }
      return { sentences, rest: current }
    }

    function resampleLinear(input, fromRate, toRate) {
      if (!input.length || fromRate === toRate) return input
      const ratio = fromRate / toRate
      const length = Math.max(1, Math.round(input.length / ratio))
      const output = new Float32Array(length)
      for (let index = 0; index < length; index += 1) {
        const position = index * ratio
        const base = Math.floor(position)
        const frac = position - base
        const a = input[Math.min(base, input.length - 1)] || 0
        const b = input[Math.min(base + 1, input.length - 1)] || a
        output[index] = a + (b - a) * frac
      }
      return output
    }

    function bytesToBase64(bytes) {
      let binary = ''
      const chunk = 0x8000
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
      }
      return btoa(binary)
    }

    function floatToPcm16(samples) {
      const pcm = new Int16Array(samples.length)
      for (let index = 0; index < samples.length; index += 1) {
        const value = Math.max(-1, Math.min(1, samples[index]))
        pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff
      }
      return new Uint8Array(pcm.buffer)
    }

    function rmsOf(values) {
      let sum = 0
      for (const value of values) sum += value * value
      return Math.sqrt(sum / Math.max(1, values.length))
    }

    function isBreezeBusy(status, body) {
      return status === 409 || status === 429 || /busy|another generation is running/i.test(String(body || ''))
    }

    function sleepUntilRetry(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        const timer = window.setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        const onAbort = () => {
          window.clearTimeout(timer)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }

    // ------------------------------------------------------------------
    // Voice button + panel
    // ------------------------------------------------------------------

    function VoiceButton(props) {
      void props
      const { sessionId, inputActions } = useVoiceContext()
      const [active, setActive] = useState(false)
      const [status, setStatus] = useState('点击开始语音通话')
      const [transcript, setTranscript] = useState('')
      const [assistantText, setAssistantText] = useState('')
      const [error, setError] = useState('')
      const [level, setLevel] = useState(0)
      const [playing, setPlaying] = useState(false)
      const [business, setBusiness] = useState(null)

      const activeRef = useRef(false)
      const sessionRef = useRef(sessionId)
      const configRef = useRef(null)
      const endpointRef = useRef(700)
      const bargeRef = useRef(true)
      const maxUtteranceRef = useRef(20)
      const mediaRef = useRef(undefined)
      const audioCtxRef = useRef(undefined)
      const sourceRef = useRef(undefined)
      const processorRef = useRef(undefined)
      const sinkRef = useRef(undefined)
      const captureRef = useRef([])
      const frameRef = useRef([])
      const uttStartRef = useRef(0)
      const speakingRef = useRef(false)
      const voiceFramesRef = useRef(0)
      const lastVoiceRef = useRef(0)
      const lastVoiceSampleRef = useRef(0)
      const uttFramesRef = useRef(0)
      const uttVoicedRef = useRef(0)
      const noiseRef = useRef(0.006)
      const resampleAccumulatorRef = useRef(0)
      const resampleCountRef = useRef(0)
      const lastLevelUpdateRef = useRef(0)
      const playingRef = useRef(false)
      const ttsBusyRef = useRef(false)
      const queueRef = useRef([])
      const ttsAbortRef = useRef(undefined)
      const ttsProcessorRef = useRef(undefined)
      const ttsPcmQueueRef = useRef([])
      const ttsDrainResolveRef = useRef(undefined)
      const genRef = useRef(0)
      const actionsRef = useRef(inputActions)
      const pendingWorkRef = useRef(null)
      const confirmBusyRef = useRef(false)
      const confirmAbortRef = useRef(undefined)
      const ttsAudioCtxRef = useRef(undefined)
      const ttsAnalyserRef = useRef(undefined)
      const ttsSourceRef = useRef(undefined)
      const ttsMouthDataRef = useRef(undefined)
      const mouthRafRef = useRef(undefined)
      const mouthPostAtRef = useRef(0)
      const voiceChatAbortRef = useRef(undefined)

      useEffect(() => { sessionRef.current = sessionId }, [sessionId])
      useEffect(() => {
        if (pendingWorkRef.current && pendingWorkRef.current.sessionId !== (sessionId || '')) {
          pendingWorkRef.current = null
          if (confirmAbortRef.current) {
            try { confirmAbortRef.current.abort() } catch {}
            confirmAbortRef.current = undefined
          }
          setStatus('工作会话已切换，待确认指令已取消')
        }
      }, [sessionId])
      useEffect(() => { actionsRef.current = inputActions }, [inputActions])

      useEffect(() => {
        let alive = true
        getJson('/config').then(result => {
          if (!alive) return
          configRef.current = result.config
          endpointRef.current = Number(result.config.endpointSilenceMs) || 700
          bargeRef.current = result.config.bargeIn !== false
          maxUtteranceRef.current = Number(result.config.maxUtteranceSec) || 20
        }).catch(() => {})
        return () => { alive = false }
      }, [])

      useEffect(() => {
        const onConfig = event => {
          const next = event.detail
          if (!next) return
          configRef.current = next
          endpointRef.current = Number(next.endpointSilenceMs) || 700
          bargeRef.current = next.bargeIn !== false
          maxUtteranceRef.current = Number(next.maxUtteranceSec) || 20
        }
        window.addEventListener('dsh-voice-config', onConfig)
        return () => window.removeEventListener('dsh-voice-config', onConfig)
      }, [])

      const publishMouth = useCallback(value => {
        // Lip sync is intentionally disabled. Keep this function as the single
        // seam for rollback, but do not post anything to the mouth bridge.
        void value
      }, [])

      const stopMouthLoop = useCallback(() => {
        if (mouthRafRef.current) {
          try { cancelAnimationFrame(mouthRafRef.current) } catch {}
          mouthRafRef.current = undefined
        }
        if (ttsSourceRef.current) {
          try { ttsSourceRef.current.disconnect() } catch {}
          ttsSourceRef.current = undefined
        }
        if (ttsAnalyserRef.current) {
          try { ttsAnalyserRef.current.disconnect() } catch {}
          ttsAnalyserRef.current = undefined
        }
        window.__dshVoiceMouth = 0
      }, [])

      const publishBusiness = useCallback(snapshot => {
        if (!snapshot || typeof snapshot !== 'object') return
        void fetch('/api/live2d-pet/business', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(snapshot),
        }).catch(() => {})
      }, [])

      const startMouthLoop = useCallback(() => {
        if (mouthRafRef.current) return
        const tick = () => {
          const analyser = ttsAnalyserRef.current
          let mouth = 0
          if (analyser) {
            if (!ttsMouthDataRef.current || ttsMouthDataRef.current.length !== analyser.fftSize) {
              ttsMouthDataRef.current = new Uint8Array(analyser.fftSize)
            }
            analyser.getByteTimeDomainData(ttsMouthDataRef.current)
            let sum = 0
            for (const sample of ttsMouthDataRef.current) {
              const centered = (sample - 128) / 128
              sum += centered * centered
            }
            const rms = Math.sqrt(sum / ttsMouthDataRef.current.length)
            mouth = Math.min(1, rms * 4.2)
          }
          window.__dshVoiceMouth = mouth
          const now = performance.now()
          if (now - mouthPostAtRef.current > 50) {
            mouthPostAtRef.current = now
            publishMouth(mouth)
          }
          mouthRafRef.current = requestAnimationFrame(tick)
        }
        mouthRafRef.current = requestAnimationFrame(tick)
      }, [publishMouth])

      const connectTtsMouth = useCallback(audio => {
        // Lip sync is off. Do not route <audio> through a MediaElementSource, so
        // playback cannot be muted by a stale analyser and no graph is retained.
        void audio
        stopMouthLoop()
      }, [stopMouthLoop])

      const stopSpeech = useCallback(() => {
        genRef.current += 1
        if (ttsAbortRef.current) {
          try { ttsAbortRef.current.abort() } catch {}
          ttsAbortRef.current = undefined
        }
        ttsPcmQueueRef.current = []
        ttsDrainResolveRef.current?.()
        ttsDrainResolveRef.current = undefined
        if (ttsProcessorRef.current) {
          try { ttsProcessorRef.current.disconnect() } catch {}
          ttsProcessorRef.current = undefined
        }
        queueRef.current = []
        playingRef.current = false
        setPlaying(false)
        stopMouthLoop()
        publishMouth(0)
      }, [publishMouth, stopMouthLoop])


      const playNext = useCallback(async () => {
        if (!activeRef.current || playingRef.current || ttsBusyRef.current || queueRef.current.length === 0) return
        const item = queueRef.current.shift()
        const sentence = typeof item === 'string' ? item : String(item?.text || '')
        const voiceDirection = typeof item === 'string' ? '' : String(item?.instructions || '')
        const generation = genRef.current
        const controller = new AbortController()
        ttsBusyRef.current = true
        ttsAbortRef.current = controller
        const pcmQueue = []
        ttsPcmQueueRef.current = pcmQueue
        let processor
        let drainResolve
        try {
          setStatus('合成语音…')
          let ctx = ttsAudioCtxRef.current
          if (!ctx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext
            if (!AudioContextClass) throw new Error('当前环境不支持 Web Audio')
            // Dedicated 24 kHz graph: no per-chunk resampling to the mic graph's
            // 48 kHz rate, which was the main source of boundary clicks.
            ctx = new AudioContextClass({ sampleRate: 24000, latencyHint: 'interactive' })
            await ctx.resume()
            ttsAudioCtxRef.current = ctx
          } else if (ctx.state === 'suspended') {
            await ctx.resume()
          }
          const targetRate = ctx.sampleRate || 24000
          let response
          let lastBusyBody = ''
          for (let attempt = 0; attempt < 8; attempt += 1) {
            response = await fetch(`${API}/tts-stream`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                text: sentence,
                voice: configRef.current?.voiceId,
                instructions: voiceDirection || configRef.current?.instruction,
              }),
              signal: controller.signal,
            })
            if (response.ok) break
            lastBusyBody = await response.text().catch(() => '')
            if (!isBreezeBusy(response.status, lastBusyBody)) {
              throw new Error(lastBusyBody || `HTTP ${response.status}`)
            }
            if (attempt === 7) {
              throw new Error('Breeze 正忙：上一条语音仍在生成，重试后仍未空闲。')
            }
            setStatus(`等待 Breeze 空闲（${attempt + 1}/8）…`)
            await sleepUntilRetry(350 + attempt * 250, controller.signal)
          }
          if (!response?.ok) throw new Error(lastBusyBody || 'TTS 请求失败')
          const streamRate = Number(response.headers.get('x-sample-rate')) || 24000
          let pending = new Uint8Array(0)
          let totalSamples = 0
          let playedSamples = 0
          let ended = false
          let started = false
          const drained = new Promise(resolve => { drainResolve = resolve })
          ttsDrainResolveRef.current = drainResolve
          processor = ctx.createScriptProcessor(1024, 1, 1)
          ttsProcessorRef.current = processor
          processor.onaudioprocess = event => {
            const out = event.outputBuffer.getChannelData(0)
            let offset = 0
            while (offset < out.length) {
              const head = pcmQueue[0]
              if (!head) {
                out.fill(0, offset)
                break
              }
              const count = Math.min(head.length, out.length - offset)
              out.set(head.subarray(0, count), offset)
              if (count === head.length) pcmQueue.shift()
              else pcmQueue[0] = head.subarray(count)
              offset += count
              playedSamples += count
            }
            if (ended && pcmQueue.length === 0 && playedSamples >= totalSamples) {
              const resolve = ttsDrainResolveRef.current
              ttsDrainResolveRef.current = undefined
              resolve?.()
            }
          }
          processor.connect(ctx.destination)
          const reader = response.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (generation !== genRef.current || controller.signal.aborted) return
            if (!value || value.byteLength === 0) continue
            const merged = new Uint8Array(pending.length + value.byteLength)
            merged.set(pending, 0)
            merged.set(value, pending.length)
            const usable = merged.byteLength - (merged.byteLength % 2)
            pending = merged.slice(usable)
            if (usable > 0) {
              const pcm = new Int16Array(merged.buffer, 0, usable / 2)
              let samples = new Float32Array(pcm.length)
              for (let index = 0; index < pcm.length; index += 1) samples[index] = pcm[index] / 32768
              if (streamRate !== targetRate) samples = resampleLinear(samples, streamRate, targetRate)
              pcmQueue.push(samples)
              totalSamples += samples.length
              if (!started) {
                started = true
                playingRef.current = true
                setPlaying(true)
                setStatus('说话中…')
              }
            }
          }
          ended = true
          if (pcmQueue.length === 0 && playedSamples >= totalSamples) drainResolve?.()
          await drained
          if (generation === genRef.current && activeRef.current) setStatus('正在听…')
        } catch (failure) {
          if (generation !== genRef.current || controller.signal.aborted) return
          setError(`TTS 失败：${failure instanceof Error ? failure.message : String(failure)}`)
          setStatus('正在听…')
        } finally {
          if (processor) {
            try { processor.disconnect() } catch {}
          }
          if (ttsProcessorRef.current === processor) ttsProcessorRef.current = undefined
          if (ttsPcmQueueRef.current === pcmQueue) ttsPcmQueueRef.current = []
          if (ttsDrainResolveRef.current === drainResolve) ttsDrainResolveRef.current = undefined
          drainResolve?.()
          ttsBusyRef.current = false
          playingRef.current = false
          setPlaying(false)
          window.__dshVoiceMouth = 0
          if (activeRef.current && queueRef.current.length > 0) {
            window.setTimeout(() => { void playNext() }, 0)
          }
        }
      }, [])

      const enqueueSpeech = useCallback((text, instructions = '') => {
        const cleaned = stripForSpeech(speechText(text))
        if (!cleaned) return
        const direction = String(instructions || '').trim()
        // Breeze streams sentence-by-sentence itself. Sending the whole short
        // reply in one streaming request removes per-sentence request/synthesis
        // gaps; only long text is split defensively.
        if (cleaned.length <= 600) {
          queueRef.current.push({ text: cleaned, instructions: direction })
        } else {
          const { sentences } = splitSpeech(cleaned)
          for (const sentence of sentences) queueRef.current.push({ text: sentence, instructions: direction })
        }
        void playNext()
      }, [playNext])

      const sendTranscript = useCallback(async text => {
        const value = String(text || '').trim()
        if (!value) return
        setTranscript(value)
        setStatus('后台思考中…')
        const controller = new AbortController()
        if (voiceChatAbortRef.current) {
          try { voiceChatAbortRef.current.abort() } catch {}
        }
        voiceChatAbortRef.current = controller
        try {
          const result = await postJson('/chat', {
            text: value,
            sessionId: sessionRef.current || '',
          }, controller.signal)
          if (!activeRef.current || controller.signal.aborted) return
          if (result.mode === 'work') {
            const instruction = String(result.instruction || value).trim()
            const pending = {
              instruction,
              sessionId: sessionRef.current || '',
              at: Date.now(),
            }
            pendingWorkRef.current = pending
            const ask = '这件事需要交给当前工作会话实际处理。可以执行吗？说“可以”或其他确认，我就开始。'
            setAssistantText(ask)
            enqueueSpeech(ask, configRef.current?.instruction)
            setStatus('等待确认工作指令…')
            return
          }
          const reply = String(speechText(result.reply) || '').trim()
          if (reply) {
            setAssistantText(reply)
            enqueueSpeech(result.reply, result.voice_direction)
          }
          setStatus('正在听…')
        } catch (failure) {
          if (controller.signal.aborted) return
          setError(`后台对话失败：${failure instanceof Error ? failure.message : String(failure)}`)
          setStatus('正在听…')
        } finally {
          if (voiceChatAbortRef.current === controller) voiceChatAbortRef.current = undefined
        }
      }, [enqueueSpeech])

      const clearPendingWork = useCallback(() => {
        pendingWorkRef.current = null
      }, [])

      const confirmPendingWork = useCallback(() => {
        const pending = pendingWorkRef.current
        if (!pending) return
        const actions = actionsRef.current
        if (!actions || typeof actions.setDraft !== 'function' || typeof actions.submit !== 'function') {
          setError('输入通道不可用，无法执行工作指令')
          return
        }
        if (pending.sessionId && pending.sessionId !== (sessionRef.current || '')) {
          clearPendingWork()
          setError('工作会话已切换，待确认指令已取消，请重新发起')
          setStatus('正在听…')
          return
        }
        clearPendingWork()
        actions.setDraft(pending.instruction)
        actions.submit()
        setAssistantText('好，交给我吧。')
        enqueueSpeech('好，交给我吧。', configRef.current?.instruction)
        setStatus('已交给工作会话…')
      }, [clearPendingWork, enqueueSpeech])

      const cancelPendingWork = useCallback(() => {
        clearPendingWork()
        setAssistantText('好，那先不动。')
        enqueueSpeech('好，那先不动。', configRef.current?.instruction)
        setStatus('正在听…')
      }, [clearPendingWork, enqueueSpeech])

      const handlePendingVoice = useCallback(async text => {
        const pending = pendingWorkRef.current
        if (!pending || confirmBusyRef.current) return
        confirmBusyRef.current = true
        const controller = new AbortController()
        confirmAbortRef.current = controller
        const timer = window.setTimeout(() => controller.abort(), 8000)
        setStatus('判断确认中…')
        try {
          const result = await postJson('/confirm-work', {
            text: String(text || '').trim(),
            instruction: pending.instruction,
            sessionId: pending.sessionId,
          }, controller.signal)
          if (!activeRef.current || pendingWorkRef.current !== pending || controller.signal.aborted) return
          const decision = String(result.decision || 'unclear')
          const confidence = Number(result.confidence)
          if (decision === 'confirm' && Number.isFinite(confidence) && confidence >= 0.7) {
            confirmPendingWork()
            return
          }
          if (decision === 'cancel' && Number.isFinite(confidence) && confidence >= 0.65) {
            cancelPendingWork()
            return
          }
          enqueueSpeech('我还不太确定你的意思。可以说“可以执行”，或者明确说“取消”。', configRef.current?.instruction)
          setStatus('等待确认工作指令…')
        } catch (failure) {
          if (controller.signal.aborted) {
            if (activeRef.current && pendingWorkRef.current === pending) {
              enqueueSpeech('确认判断超时了。请明确说“可以执行”或“取消”。', configRef.current?.instruction)
              setStatus('等待确认工作指令…')
            }
            return
          }
          if (!activeRef.current || pendingWorkRef.current !== pending) return
          enqueueSpeech('确认判断暂时不可用。我没有执行，请明确说“可以执行”或“取消”。', configRef.current?.instruction)
          setStatus('等待确认工作指令…')
        } finally {
          window.clearTimeout(timer)
          if (confirmAbortRef.current === controller) confirmAbortRef.current = undefined
          confirmBusyRef.current = false
        }
      }, [cancelPendingWork, confirmPendingWork, enqueueSpeech])

      const finalizeUtterance = useCallback(async () => {
        if (!speakingRef.current) return
        speakingRef.current = false
        voiceFramesRef.current = 0
        const start = Math.max(0, uttStartRef.current)
        const end = Math.min(
          captureRef.current.length,
          lastVoiceSampleRef.current + Math.round(0.15 * SAMPLE_RATE),
        )
        const data = end > start ? captureRef.current.slice(start, end) : []
        const voicedFrames = uttVoicedRef.current
        const voicedRatio = uttFramesRef.current > 0 ? voicedFrames / uttFramesRef.current : 0
        uttStartRef.current = captureRef.current.length
        lastVoiceSampleRef.current = 0
        uttFramesRef.current = 0
        uttVoicedRef.current = 0
        frameRef.current = []
        // Mostly-silent clips make SenseVoice invent words. Keep short real
        // replies ("嗯", "好", "停") — 200 ms / 6 voiced frames is enough — but
        // reject clips whose energy was mostly background.
        if (data.length < SAMPLE_RATE * 0.2 || voicedFrames < 6 || voicedRatio < 0.2) {
          if (activeRef.current) setStatus('没听清，再说一次')
          return
        }
        setStatus('识别中…')
        try {
          const result = await postJson('/asr', {
            pcm: bytesToBase64(floatToPcm16(data)),
            sampleRate: SAMPLE_RATE,
          })
          if (!activeRef.current) return
          const text = String(result.text || '').trim()
          if (text) {
            if (pendingWorkRef.current) {
              handlePendingVoice(text)
              return
            }
            void sendTranscript(text)
          } else {
            setStatus('没听清，再说一次')
          }
        } catch (failure) {
          setError(`识别失败：${failure instanceof Error ? failure.message : String(failure)}`)
          setStatus('正在听…')
        }
      }, [sendTranscript, handlePendingVoice])

      const vadFrame = useCallback((rms) => {
        const now = performance.now()
        const threshold = Math.max(0.0065, noiseRef.current * 2.2) * (playingRef.current ? 2.0 : 1)
        if (rms > threshold) {
          voiceFramesRef.current += 1
          lastVoiceRef.current = now
          if (speakingRef.current) {
            uttFramesRef.current += 1
            uttVoicedRef.current += 1
            lastVoiceSampleRef.current = captureRef.current.length
          } else if (voiceFramesRef.current >= ((playingRef.current || ttsAbortRef.current) ? 4 : 2)) {
            speakingRef.current = true
            const preroll = Math.round(0.2 * SAMPLE_RATE)
            uttStartRef.current = Math.max(0, captureRef.current.length - preroll)
            lastVoiceSampleRef.current = captureRef.current.length
            uttFramesRef.current = 1
            uttVoicedRef.current = 1
            if (bargeRef.current && (playingRef.current || ttsAbortRef.current)) {
              stopSpeech()
              setStatus('检测到插话，正在听…')
            } else if (activeRef.current) {
              setStatus('正在听…')
            }
          }
        } else if (speakingRef.current) {
          uttFramesRef.current += 1
          if (now - lastVoiceRef.current >= endpointRef.current) {
            void finalizeUtterance()
          }
        } else {
          noiseRef.current = noiseRef.current * 0.98 + rms * 0.02
          voiceFramesRef.current = 0
        }
        if (speakingRef.current) {
          const duration = (captureRef.current.length - uttStartRef.current) / SAMPLE_RATE
          if (duration >= maxUtteranceRef.current) void finalizeUtterance()
        }
        if (now - lastLevelUpdateRef.current > 90) {
          lastLevelUpdateRef.current = now
          setLevel(Math.min(1, rms * 18))
        }
      }, [finalizeUtterance, stopSpeech])

      const onSample = useCallback((sample) => {
        const capture = captureRef.current
        capture.push(sample)
        if (capture.length > SAMPLE_RATE * 35) {
          const drop = capture.length - SAMPLE_RATE * 30
          capture.splice(0, drop)
          uttStartRef.current = Math.max(0, uttStartRef.current - drop)
        }
        const frame = frameRef.current
        frame.push(sample)
        if (frame.length >= 320) {
          const values = frame.splice(0, frame.length)
          vadFrame(rmsOf(values))
        }
      }, [vadFrame])

      const onAudioProcess = useCallback((event) => {
        if (!activeRef.current) return
        const inputData = event.inputBuffer.getChannelData(0)
        const ratio = (audioCtxRef.current?.sampleRate || 48000) / SAMPLE_RATE
        for (let index = 0; index < inputData.length; index += 1) {
          resampleAccumulatorRef.current += inputData[index]
          resampleCountRef.current += 1
          if (resampleCountRef.current >= ratio) {
            const sample = resampleAccumulatorRef.current / resampleCountRef.current
            resampleAccumulatorRef.current = 0
            resampleCountRef.current = 0
            onSample(sample)
          }
        }
      }, [onSample])

      const stopCall = useCallback(() => {
        activeRef.current = false
        pendingWorkRef.current = null
        if (confirmAbortRef.current) {
          try { confirmAbortRef.current.abort() } catch {}
          confirmAbortRef.current = undefined
        }
        confirmBusyRef.current = false
        setActive(false)
        if (voiceChatAbortRef.current) {
          try { voiceChatAbortRef.current.abort() } catch {}
          voiceChatAbortRef.current = undefined
        }
        stopSpeech()
        speakingRef.current = false
        voiceFramesRef.current = 0
        captureRef.current = []
        frameRef.current = []
        uttStartRef.current = 0
        lastVoiceSampleRef.current = 0
        uttFramesRef.current = 0
        uttVoicedRef.current = 0
        noiseRef.current = 0.006
        lastVoiceRef.current = 0
        if (processorRef.current) {
          try { processorRef.current.disconnect() } catch {}
          processorRef.current = undefined
        }
        if (sourceRef.current) {
          try { sourceRef.current.disconnect() } catch {}
          sourceRef.current = undefined
        }
        if (sinkRef.current) {
          try { sinkRef.current.disconnect() } catch {}
          sinkRef.current = undefined
        }
        if (mediaRef.current) {
          try { for (const track of mediaRef.current.getTracks()) track.stop() } catch {}
          mediaRef.current = undefined
        }
        if (audioCtxRef.current) {
          try { void audioCtxRef.current.close() } catch {}
          audioCtxRef.current = undefined
        }
        if (ttsAudioCtxRef.current) {
          try { void ttsAudioCtxRef.current.close() } catch {}
          ttsAudioCtxRef.current = undefined
        }
        setLevel(0)
        setStatus('已停止')
      }, [stopSpeech])

      const startCall = useCallback(async () => {
        if (activeRef.current) return
        setError('')
        setStatus('连接本地语音服务…')
        try {
          const health = await getJson('/health')
          if (!health.breeze || health.breeze.ok !== true) {
            throw new Error('Breeze TTS 未运行：请先在设置里启动，或运行 D:\\AI\\runtimes 下的 breeze-server。')
          }
          if (!health.asr?.ready && health.asr?.error) {
            throw new Error(`ASR 未就绪：${health.asr.error}`)
          }
          try {
            // Settings may have changed since this overlay mounted. Read the
            // saved voice/config once at call start; the Host remains
            // authoritative for the actual TTS request too.
            const latest = await getJson('/config')
            if (latest?.config) {
              configRef.current = latest.config
              endpointRef.current = Number(latest.config.endpointSilenceMs) || 700
              bargeRef.current = latest.config.bargeIn !== false
              maxUtteranceRef.current = Number(latest.config.maxUtteranceSec) || 20
            }
          } catch {
            /* keep the last good config */
          }
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('当前环境没有麦克风接口')
          }
          const media = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          })
          const AudioContextClass = window.AudioContext || window.webkitAudioContext
          if (!AudioContextClass) throw new Error('当前环境不支持 Web Audio')
          const audioCtx = new AudioContextClass()
          await audioCtx.resume()
          try {
            if (!ttsAudioCtxRef.current) {
              ttsAudioCtxRef.current = new AudioContextClass({ sampleRate: 24000, latencyHint: 'interactive' })
              await ttsAudioCtxRef.current.resume()
            }
          } catch {
            /* TTS context can still be created lazily on first speech */
          }
          const source = audioCtx.createMediaStreamSource(media)
          const processor = audioCtx.createScriptProcessor(4096, 1, 1)
          const sink = audioCtx.createGain()
          sink.gain.value = 0
          source.connect(processor)
          processor.connect(sink)
          sink.connect(audioCtx.destination)
          processor.onaudioprocess = onAudioProcess
          mediaRef.current = media
          audioCtxRef.current = audioCtx
          sourceRef.current = source
          processorRef.current = processor
          sinkRef.current = sink
          activeRef.current = true
          setActive(true)
          setStatus('正在听…')
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : String(failure)
          setError(message)
          setStatus('未启动')
          try { stopCall() } catch {}
          setStatus('未启动')
        }
      }, [onAudioProcess, stopCall])

      useEffect(() => () => {
        try { stopCall() } catch {}
      }, [stopCall])

      const toggle = useCallback(() => {
        if (activeRef.current) stopCall()
        else void startCall()
      }, [startCall, stopCall])

      useEffect(() => {
        if (!active) {
          setBusiness(null)
          return undefined
        }
        let cancelled = false
        const load = async () => {
          try {
            const result = await getJson(`/business?sessionId=${encodeURIComponent(sessionId || '')}`)
            if (!cancelled) {
              setBusiness(result.snapshot || null)
              publishBusiness(result.snapshot || null)
            }
          } catch (failure) {
            if (!cancelled) setBusiness({
              task: { status: 'unknown', detail: String(failure.message || failure) },
              balance: { status: 'unavailable', detail: '账本适配器不可用' },
            })
          }
        }
        void load()
        const timer = window.setInterval(load, 5000)
        return () => {
          cancelled = true
          window.clearInterval(timer)
        }
      }, [active, sessionId, publishBusiness])

      const statusClass = error ? 'dshvd-error' : active ? 'dshvd-live' : ''
      const balanceLabel = business?.balance?.status === 'available'
        && Number.isFinite(Number(business.balance.amount))
        ? `${business.balance.currency || ''} ${Number(business.balance.amount).toFixed(2)}`
        : (business?.balance?.status || 'unavailable')
      const iconSrc = active
        ? `${API}/assets/voice-call-on.png?v=8`
        : `${API}/assets/voice-call-off.png?v=8`
      const unavailable = !sessionId && !active
      const activate = () => {
        if (unavailable) return
        toggle()
      }
      return h('div', { className: 'dshvd-root' },
        h('span', {
          className: `dshvd-btn${active ? ' dshvd-btn-active' : ''}`,
          role: 'button',
          tabIndex: unavailable ? -1 : 0,
          title: unavailable ? '先在对话中开始一个会话' : active ? '结束语音通话' : '开始语音通话（全双工）',
          'aria-label': active ? '语音通话开' : '语音通话关',
          'aria-disabled': unavailable ? 'true' : 'false',
          style: {
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
          },
          onClick: activate,
          onKeyDown: event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              activate()
            }
          },
        }, h('img', {
          className: 'dshvd-icon',
          src: iconSrc,
          alt: active ? '语音通话开' : '语音通话关',
          draggable: false,
          style: { background: 'transparent' },
        })),
        active || error ? h('div', { className: `dshvd-panel ${statusClass}` },
          ...['tl', 'tr', 'bl', 'br'].map(position => h('span', {
            key: position,
            className: `dshvd-corner dshvd-corner-${position}`,
            'aria-hidden': 'true',
          })),
          h('div', { className: 'dshvd-frame' },
            h('div', { className: 'dshvd-head' },
              h('div', { className: 'dshvd-brand' },
                h('span', { className: 'dshvd-headset' },
                  h('svg', {
                    viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none',
                    stroke: 'currentColor', strokeWidth: 1.6,
                    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
                  },
                    h('path', { d: 'M4 14v-2a8 8 0 0 1 16 0v2' }),
                    h('rect', { x: '3', y: '13', width: '4', height: '7', rx: '2' }),
                    h('rect', { x: '17', y: '13', width: '4', height: '7', rx: '2' }),
                  ),
                ),
                h('span', { className: 'dshvd-title' }, active ? '语音通话中' : '语音通话'),
                h('span', { className: 'dshvd-title-star', 'aria-hidden': 'true' }, '✦'),
              ),
              h('div', { className: 'dshvd-head-actions' },
                h('button', {
                  type: 'button',
                  className: 'dshvd-stop',
                  onClick: () => { setError(''); stopCall() },
                  title: '结束通话',
                }, h('span', { className: 'dshvd-stop-square' }), '停止'),
              ),
            ),
            h('div', { className: 'dshvd-rule' },
              h('span', { className: 'dshvd-rule-star', 'aria-hidden': 'true' }, '✦'),
            ),
            h('div', { className: 'dshvd-statusrow' },
              h('span', { className: 'dshvd-dot' + (active ? ' on' : '') }),
              h('span', { className: 'dshvd-wave' + (active ? ' live' : '') },
                ...[0.45, 0.7, 1, 0.6, 0.8].map((factor, index) => h('i', {
                  key: index,
                  style: { height: `${Math.max(3, Math.round(level * 14 * factor))}px` },
                })),
              ),
              h('span', { className: 'dshvd-status' }, status),
              h('span', { className: 'dshvd-meter' },
                ...Array.from({ length: 12 }, (_, index) => h('i', {
                  key: index,
                  style: {
                    height: `${3 + Math.round(level * 9 * (1 + (index % 4)) / 4)}px`,
                    opacity: 0.24 + level * 0.6,
                  },
                })),
              ),
            ),
            h('div', { className: 'dshvd-business', 'aria-label': '任务与余额状态' },
              h('span', null, h('b', null, '任务'), ' ', business?.task?.status || 'unknown'),
              h('span', { className: 'dshvd-business-muted' }, h('b', null, '余额'), ' ', balanceLabel),
            ),
            transcript || assistantText ? h('div', { className: 'dshvd-thread' },
              transcript ? h('div', { className: 'dshvd-msg dshvd-msg-user' },
                h('span', { className: 'dshvd-avatar dshvd-avatar-user' },
                  h('svg', {
                    viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none',
                    stroke: 'currentColor', strokeWidth: 1.45,
                    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
                  },
                    h('path', { d: 'M12 2.5l2.7 6.2 6.8.7-5.2 4.5 1.6 6.6-5.9-3.4-5.9 3.4 1.6-6.6-5.2-4.5 6.8-.7z' }),
                  ),
                ),
                h('span', { className: 'dshvd-who' }, '你：'),
                h('div', { className: 'dshvd-bubble dshvd-bubble-user' },
                  h('p', { className: 'dshvd-say' }, transcript),
                  h('span', { className: 'dshvd-spark', 'aria-hidden': 'true' }, '✦'),
                ),
              ) : null,
              assistantText ? h('div', { className: 'dshvd-msg dshvd-msg-assistant' },
                h('span', { className: 'dshvd-avatar dshvd-avatar-bot' },
                  h('img', { src: `${API}/assets/answer-avatar.png?v=1`, alt: '', draggable: false }),
                ),
                h('span', { className: 'dshvd-who' }, '回答：'),
                h('div', { className: 'dshvd-bubble dshvd-bubble-assistant' },
                  h('p', { className: 'dshvd-say' }, assistantText),
                  h('span', { className: 'dshvd-spark', 'aria-hidden': 'true' }, '✦'),
                ),
              ) : null,
            ) : null,
            error ? h('div', { className: 'dshvd-errorbox' }, error) : null,
            h('div', { className: 'dshvd-footer' },
              h('div', { className: 'dshvd-rule dshvd-rule-footer' },
                h('span', { className: 'dshvd-rule-star', 'aria-hidden': 'true' }, '✦'),
              ),
              h('div', { className: 'dshvd-hint' },
                h('span', { className: 'dshvd-info' }, 'ⓘ'),
                h('span', null, active ? '说话即可插话，点停止结束。' : '点图标开始；麦克风与本地 ASR/TTS 都在本机。'),
              ),
            ),
          ),
        ) : null,
      )
    }

    // ------------------------------------------------------------------
    // Settings page
    // ------------------------------------------------------------------

    function formatBytes(value) {
      const bytes = Number(value) || 0
      if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
      if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
      return `${Math.round(bytes / 1024)} KB`
    }

    function ModelInstaller() {
      const [catalog, setCatalog] = useState(null)
      const [status, setStatus] = useState(null)
      const [install, setInstall] = useState(null)
      const [modelId, setModelId] = useState('')
      const [modelDir, setModelDir] = useState('')
      const [installRuntime, setInstallRuntime] = useState(true)
      const [installAsr, setInstallAsr] = useState(true)
      const [acceptLicense, setAcceptLicense] = useState(false)
      const [message, setMessage] = useState('')
      const [busy, setBusy] = useState(false)
      const [expanded, setExpanded] = useState(null)

      const loadCatalog = useCallback(async () => {
        try {
          const result = await getJson('/models/catalog')
          setCatalog(result)
          setModelId(current => current || result.recommended || 'q4_k')
          setModelDir(current => current || result.modelDir || '')
        } catch (failure) {
          setMessage(`读取模型目录失败：${failure.message || failure}`)
        }
      }, [])

      const loadStatus = useCallback(async dir => {
        try {
          const query = dir ? `?modelDir=${encodeURIComponent(dir)}` : ''
          setStatus(await getJson(`/models/status${query}`))
        } catch (failure) {
          setMessage(`读取安装状态失败：${failure.message || failure}`)
        }
      }, [])

      useEffect(() => { void loadCatalog() }, [loadCatalog])
      useEffect(() => { void loadStatus(modelDir) }, [loadStatus, modelDir])
      useEffect(() => {
        if (!install || install.status !== 'running') return undefined
        const timer = window.setInterval(async () => {
          try {
            const result = await getJson('/models/progress')
            setInstall(result.install)
            if (result.install?.status !== 'running') {
              await loadCatalog()
              await loadStatus(modelDir)
              try {
                const configResult = await getJson('/config')
                window.dispatchEvent(new CustomEvent('dsh-voice-config', { detail: configResult.config }))
              } catch {}
            }
          } catch {}
        }, 1000)
        return () => window.clearInterval(timer)
      }, [install, loadCatalog, loadStatus, modelDir])

      const selected = catalog?.models?.find(model => model.id === modelId)
      const installedModel = status?.installed?.models?.find(model => model.id === modelId)

      const start = useCallback(async () => {
        if (!modelId) return
        setBusy(true)
        setMessage('')
        try {
          const result = await postJson('/models/install', {
            modelId,
            modelDir,
            installRuntime,
            installAsr,
            acceptLicense,
          })
          setInstall({ status: result.status || 'running', progress: { phase: 'starting' } })
          setMessage('安装已开始。大模型下载可能需要几分钟到几十分钟，请不要关闭 DSH。')
        } catch (failure) {
          setMessage(`启动安装失败：${failure.message || failure}`)
        } finally {
          setBusy(false)
        }
      }, [installAsr, installRuntime, acceptLicense, modelDir, modelId])

      const cancel = useCallback(async () => {
        try {
          await postJson('/models/cancel', {})
          setMessage('已请求取消；正在进行的下载会停止。')
        } catch (failure) {
          setMessage(`取消失败：${failure.message || failure}`)
        }
      }, [])

      const progress = install?.progress
      const hardware = catalog?.hardware
      const progressText = progress?.completedBytes !== undefined
        ? `${progress.name || ''} ${formatBytes(progress.completedBytes)} / ${formatBytes(progress.totalBytes)}`
        : progress?.phase || ''
      const runtimeReady = Boolean(status?.installed?.runtime?.installed)
      const asrReady = Boolean(status?.installed?.asr?.model?.installed && status?.installed?.asr?.tokens?.installed)
      const modelReady = Boolean(installedModel?.installed)
      const voicesReady = Boolean(status?.installed?.voices?.installed)
      const ready = modelReady && runtimeReady && asrReady && voicesReady
      const visible = expanded ?? (status ? !ready : false)
      const summary = `${selected?.label || '模型'}${ready ? ' · 已就绪' : ' · 待配置'}`
      const hardwareText = hardware
        ? `${hardware.gpu?.name || 'GPU 未检测'}${hardware.gpu?.vramGB ? ` · ${hardware.gpu.vramGB} GB` : ''} · 推荐 ${String(catalog?.recommended || 'q4_k').toUpperCase()}`
        : '正在检测硬件…'

      return h('section', { className: 'dshvd-models' },
        h('div', { className: 'dshvd-models-head' },
          h('div', { className: 'dshvd-models-heading' },
            h('strong', null, '模型与依赖'),
            h('span', { className: ready ? 'dshvd-model-ok' : 'dshvd-model-warn' }, summary),
          ),
          h('button', {
            type: 'button',
            className: 'dshvd-model-toggle',
            onClick: () => setExpanded(!visible),
          }, visible ? '收起' : '配置'),
        ),
        visible ? h('div', { className: 'dshvd-models-body' },
          h('div', { className: 'dshvd-model-hint' }, hardwareText),
          h('div', { className: 'dshvd-model-grid' },
            h('label', { className: 'dshvd-field' },
              h('span', { className: 'dshvd-label' }, 'TTS 模型'),
              h('select', {
                className: 'dshvd-input',
                value: modelId,
                onChange: event => setModelId(event.target.value),
              }, ...(catalog?.models || []).map(model => h('option', { key: model.id, value: model.id },
                `${model.label} · ${formatBytes(model.bytes)}`,
              ))),
            ),
            h('label', { className: 'dshvd-field' },
              h('span', { className: 'dshvd-label' }, '模型保存路径'),
              h('input', {
                className: 'dshvd-input',
                value: modelDir,
                onChange: event => setModelDir(event.target.value),
                placeholder: '留空使用默认目录',
              }),
            ),
          ),
          h('div', { className: 'dshvd-model-checks' },
            h('label', { className: 'dshvd-check' },
              h('input', { type: 'checkbox', checked: installRuntime, onChange: event => setInstallRuntime(event.target.checked) }),
              `运行时 ${runtimeReady ? '✓' : ''}`,
            ),
            h('label', { className: 'dshvd-check' },
              h('input', { type: 'checkbox', checked: installAsr, onChange: event => setInstallAsr(event.target.checked) }),
              `ASR ${asrReady ? '✓' : ''}`,
            ),
            h('label', { className: 'dshvd-check' },
              h('input', { type: 'checkbox', checked: acceptLicense, onChange: event => setAcceptLicense(event.target.checked) }),
              '接受非商用许可',
            ),
            h('span', { className: 'dshvd-hintline' }, '随包音色 15 个'),
          ),
          h('div', { className: 'dshvd-model-state' },
            h('span', null, modelReady ? '模型 ✓' : '模型 —'),
            h('span', null, runtimeReady ? '运行时 ✓' : '运行时 —'),
            h('span', null, asrReady ? 'ASR ✓' : 'ASR —'),
            h('span', null, voicesReady ? '音色 ✓' : '音色 —'),
          ),
          h('div', { className: 'dshvd-actions' },
            h('button', { type: 'button', className: 'dshvd-action', disabled: busy || !acceptLicense || install?.status === 'running', onClick: start }, '安装 / 更新'),
            install?.status === 'running' ? h('button', { type: 'button', className: 'dshvd-action', onClick: cancel }, '取消下载') : null,
          ),
          progress && install?.status === 'running' ? h('div', { className: 'dshvd-progress' },
            h('div', { className: 'dshvd-progress-bar', style: { width: progress.totalBytes ? `${Math.min(100, (Number(progress.completedBytes) || 0) / Number(progress.totalBytes) * 100)}%` : '2%' } }),
            h('span', null, progressText),
          ) : null,
          message ? h('div', { className: 'dshvd-message' }, message) : null,
        ) : null,
        !visible && message ? h('div', { className: 'dshvd-message' }, message) : null,
      )
    }

    function SettingsPage() {
      const [config, setConfig] = useState(undefined)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const [voices, setVoices] = useState([])
      const [testText, setTestText] = useState('你好，我是你的语音助手，现在可以听见我说话吗？')

      const reload = useCallback(() => {
        getJson('/config').then(result => setConfig(result.config)).catch(failure => setMessage(String(failure.message || failure)))
      }, [])

      useEffect(() => { reload() }, [reload])

      useEffect(() => {
        const onConfig = event => { if (event.detail) setConfig(event.detail) }
        window.addEventListener('dsh-voice-config', onConfig)
        return () => window.removeEventListener('dsh-voice-config', onConfig)
      }, [])

      const change = useCallback((key, value) => {
        setConfig(current => current ? { ...current, [key]: value } : current)
      }, [])

      const save = useCallback(async () => {
        if (!config) return
        setBusy(true)
        setMessage('')
        try {
          const result = await putJson('/config', config)
          setConfig(result.config)
          window.dispatchEvent(new CustomEvent('dsh-voice-config', { detail: result.config }))
          setMessage('已保存。新的语音请求立即生效。')
        } catch (failure) {
          setMessage(`保存失败：${failure.message || failure}`)
        } finally {
          setBusy(false)
        }
      }, [config])

      const startServer = useCallback(async () => {
        setBusy(true)
        setMessage('正在启动 Breeze…')
        try {
          const result = await postJson('/server/start', {})
          setMessage(result.started ? 'Breeze 已启动。' : 'Breeze 已经在运行。')
        } catch (failure) {
          setMessage(`启动失败：${failure.message || failure}`)
        } finally {
          setBusy(false)
        }
      }, [])

      const refreshVoices = useCallback(async () => {
        setBusy(true)
        try {
          const result = await getJson('/voices')
          setVoices(result.voices || [])
          setMessage(`已读取 ${result.voices?.length || 0} 个音色`)
        } catch (failure) {
          setMessage(`读取音色失败：${failure.message || failure}`)
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => { void refreshVoices() }, [refreshVoices])

      const voiceName = useCallback(voice => {
        const description = String(voice?.description || '').trim()
        if (description) return description
        return voice?.id === 'dafeiyu' ? '大肥鱼' : String(voice?.id || '')
      }, [])

      const testTts = useCallback(async () => {
        setBusy(true)
        setMessage('正在生成测试语音…')
        try {
          const response = await fetch(`${API}/tts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: testText, voice: config?.voiceId }),
          })
          if (!response.ok) throw new Error(await response.text())
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.onended = () => URL.revokeObjectURL(url)
          await audio.play()
          setMessage('测试语音已播放。')
        } catch (failure) {
          setMessage(`测试失败：${failure.message || failure}`)
        } finally {
          setBusy(false)
        }
      }, [config?.voiceId, testText])

      if (!config) return h('div', { className: 'dshvd-settings' }, message || '正在读取配置…')

      const field = (label, key, type = 'text', hint = '') => h('label', { className: 'dshvd-field', key },
        h('span', { className: 'dshvd-label' }, label),
        h('input', {
          className: 'dshvd-input',
          type,
          value: config[key] ?? '',
          checked: type === 'checkbox' ? Boolean(config[key]) : undefined,
          onChange: event => change(key, type === 'checkbox' ? event.target.checked : type === 'number' ? Number(event.target.value) : event.target.value),
        }),
        hint ? h('span', { className: 'dshvd-hintline' }, hint) : null,
      )

      return h('div', { className: 'dshvd-settings' },
        h('h3', { className: 'dshvd-h3' }, '语音通话'),
        h('p', { className: 'dshvd-p' }, '全双工语音：麦克风持续监听，助手说话时可插话打断；转写走本地 SenseVoice，语音走本地 Breeze TTS。'),
        h(ModelInstaller, null),
        h('div', { className: 'dshvd-grid' },
          field('Breeze HTTP 地址', 'breezeUrl'),
          h('label', { className: 'dshvd-field', key: 'voiceId' },
            h('span', { className: 'dshvd-label' }, '音色'),
            h('select', {
              className: 'dshvd-input',
              value: config.voiceId || '',
              onChange: event => change('voiceId', event.target.value),
            },
              ...voices.map(voice => h('option', { key: voice.id, value: voice.id }, voiceName(voice))),
              config.voiceId && !voices.some(voice => voice.id === config.voiceId)
                ? h('option', { value: config.voiceId }, voiceName({ id: config.voiceId }))
                : null,
            ),
            h('span', { className: 'dshvd-hintline' }, '选择后点「保存配置」生效'),
          ),
          field('ASR 模型', 'asrModelPath'),
          field('ASR tokens', 'asrTokensPath'),
          field('ASR 语言', 'asrLanguage', 'text', 'auto / zh / en'),
          field('ASR 线程', 'asrThreads', 'number'),
          field('断句静音 (ms)', 'endpointSilenceMs', 'number'),
          field('最长一句 (秒)', 'maxUtteranceSec', 'number'),
          field('语速倍率', 'speechRate', 'number', '1.0 原速；0.9 稍慢；0.75 很慢'),
          h('label', { className: 'dshvd-check', key: 'bargeIn' },
            h('input', { type: 'checkbox', checked: Boolean(config.bargeIn), onChange: event => change('bargeIn', event.target.checked) }),
            '允许说话打断播报（barge-in）',
          ),
        ),
        h('div', { className: 'dshvd-actions' },
          h('button', { type: 'button', className: 'dshvd-action', disabled: busy, onClick: save }, '保存配置'),
          h('button', { type: 'button', className: 'dshvd-action', disabled: busy, onClick: startServer }, '启动 Breeze'),
          h('button', { type: 'button', className: 'dshvd-action', disabled: busy, onClick: refreshVoices }, '刷新音色'),
        ),
        h('div', { className: 'dshvd-test' },
          h('input', { className: 'dshvd-input', value: testText, onChange: event => setTestText(event.target.value) }),
          h('button', { type: 'button', className: 'dshvd-action', disabled: busy, onClick: testTts }, '试听当前音色'),
        ),
        voices.length > 0 ? h('div', { className: 'dshvd-voices' }, '可用音色：' + voices.map(voice => voiceName(voice)).join('、')) : null,
        message ? h('div', { className: 'dshvd-message' }, message) : null,
        h('p', { className: 'dshvd-p' }, '隐私：音频只在本机麦克风、SenseVoice 与 Breeze 之间流动；DSH 只接收最终转写文本。Breeze 权重为非商用许可，个人使用可以，商用需另行授权。'),
      )
    }

    const CSS = `
      .dshvd-root { display: inline-flex; align-items: center; background: transparent !important; }
      .dshvd-overlay-root { position: fixed; right: 24px; bottom: 22px; z-index: 10002; pointer-events: auto; }
      .dshvd-btn { width: 34px; height: 34px; border: 0 !important; border-radius: 9px; background: #2d4da8 !important; box-shadow: none !important; padding: 0; margin: 0; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; user-select: none; -webkit-tap-highlight-color: transparent; }
      .dshvd-btn:hover { transform: scale(1.06); }
      .dshvd-btn:focus { outline: none; }
      .dshvd-btn[aria-disabled="true"] { cursor: default; opacity: .45; transform: none; }
      .dshvd-btn-active { box-shadow: none !important; border-radius: 9px; }
      .dshvd-icon { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; background: transparent !important; border: 0 !important; filter: none; }
      .dshvd-head-actions { display: flex; align-items: center; gap: 7px; flex: 0 0 auto; }
      .dshvd-panel { position: fixed; right: 24px; bottom: 100px; width: 432px; max-width: calc(100vw - 28px); z-index: 10000; color: #f4ead6; font-size: 12px; line-height: 1.5; overflow: hidden; border: 1px solid rgba(231,199,128,.62); border-radius: 20px; background: radial-gradient(120% 90% at -5% -10%, rgba(245,207,123,.18), transparent 42%), radial-gradient(100% 100% at 105% 110%, rgba(72,105,235,.30), transparent 55%), linear-gradient(145deg, #0c1638 0%, #0a122e 48%, #060c20 100%); box-shadow: 0 24px 65px rgba(0,0,0,.60), 0 0 0 1px rgba(80,110,220,.18), inset 0 0 45px rgba(48,86,210,.12); backdrop-filter: blur(20px); }
      .dshvd-panel::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .9; background-image: radial-gradient(circle at 10% 14%, rgba(255,236,190,.95) 0 1px, transparent 1.7px), radial-gradient(circle at 86% 9%, rgba(255,236,190,.6) 0 1px, transparent 1.7px), radial-gradient(circle at 94% 78%, rgba(157,190,255,.65) 0 1px, transparent 1.7px), radial-gradient(circle at 6% 86%, rgba(255,236,190,.42) 0 1px, transparent 1.7px), radial-gradient(circle at 54% 3%, rgba(255,255,255,.45) 0 .8px, transparent 1.4px); }
      .dshvd-panel::after { content: ''; position: absolute; inset: 7px; border: 1px solid rgba(231,199,128,.16); border-radius: 14px; pointer-events: none; }
      .dshvd-panel.dshvd-error { border-color: rgba(255,128,128,.52); }
      .dshvd-corner { position: absolute; width: 24px; height: 24px; z-index: 2; pointer-events: none; border-color: rgba(231,199,128,.85); border-style: solid; }
      .dshvd-corner::after { content: '✦'; position: absolute; font-size: 7px; line-height: 1; color: rgba(245,220,160,.92); }
      .dshvd-corner-tl { left: 7px; top: 7px; border-width: 1px 0 0 1px; border-radius: 10px 0 0 0; }
      .dshvd-corner-tl::after { right: -2px; top: -4px; }
      .dshvd-corner-tr { right: 7px; top: 7px; border-width: 1px 1px 0 0; border-radius: 0 10px 0 0; }
      .dshvd-corner-tr::after { left: -2px; top: -4px; }
      .dshvd-corner-bl { left: 7px; bottom: 7px; border-width: 0 0 1px 1px; border-radius: 0 0 0 10px; }
      .dshvd-corner-bl::after { right: -2px; bottom: -4px; }
      .dshvd-corner-br { right: 7px; bottom: 7px; border-width: 0 1px 1px 0; border-radius: 0 0 10px 0; }
      .dshvd-corner-br::after { left: -2px; bottom: -4px; }
      .dshvd-frame { position: relative; z-index: 1; margin: 7px; padding: 17px 18px 12px; border: 1px solid rgba(231,199,128,.16); border-radius: 14px; background: linear-gradient(180deg, rgba(15,27,64,.32), rgba(7,13,32,.10)); }
      .dshvd-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .dshvd-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .dshvd-headset { width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center; color: #e9c977; border: 1px solid rgba(231,199,128,.48); border-radius: 50%; background: radial-gradient(circle at 38% 30%, rgba(255,225,150,.18), transparent 70%); box-shadow: inset 0 0 16px rgba(230,198,124,.14), 0 0 18px rgba(230,198,124,.08); }
      .dshvd-title { font-family: Georgia, 'Noto Serif SC', 'Songti SC', serif; font-size: 17px; font-weight: 600; letter-spacing: .08em; color: #f4e3b5; text-shadow: 0 0 18px rgba(244,202,112,.28); white-space: nowrap; }
      .dshvd-title-star { color: #efd28d; font-size: 12px; margin-left: 1px; text-shadow: 0 0 10px rgba(244,202,112,.55); }
      .dshvd-stop { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border: 1px solid rgba(231,199,128,.55) !important; border-radius: 999px; background: linear-gradient(180deg, #a83245, #6b1829) !important; color: #ffe4d6 !important; font-size: 12px; cursor: pointer; box-shadow: inset 0 0 16px rgba(255,170,150,.12), 0 3px 12px rgba(80,10,20,.35); }
      .dshvd-stop:hover { border-color: rgba(255,220,160,.85) !important; background: linear-gradient(180deg, #bf3a50, #7c1d30) !important; }
      .dshvd-stop-square { width: 9px; height: 9px; border-radius: 2px; background: #ffe9e1; box-shadow: 0 0 9px rgba(255,210,190,.6); }
      .dshvd-rule { position: relative; height: 1px; margin: 12px 0 10px; background: linear-gradient(90deg, transparent, rgba(231,199,128,.62), transparent); }
      .dshvd-rule-star { position: absolute; left: 50%; top: -6px; transform: translateX(-50%); padding: 0 5px; font-size: 8px; line-height: 1; color: #efd28d; background: #0a122e; }
      .dshvd-statusrow { display: flex; align-items: center; gap: 9px; padding: 1px 3px 11px; border-bottom: 1px solid rgba(130,160,220,.14); }
      .dshvd-business { display: flex; justify-content: space-between; gap: 10px; padding: 7px 3px 9px; border-bottom: 1px solid rgba(156,186,255,.16); color: #a9cbf5; font-size: 10px; letter-spacing: .02em; }
      .dshvd-business b { color: #f1dc9c; font-weight: 600; }
      .dshvd-business-muted { color: #7f8fae; }
      .dshvd-dot { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; background: #5c6785; }
      .dshvd-dot.on { background: #51d88a; box-shadow: 0 0 0 3px rgba(81,216,138,.12), 0 0 12px rgba(81,216,138,.65); }
      .dshvd-wave { display: flex; align-items: flex-end; gap: 2px; height: 15px; }
      .dshvd-wave i { width: 2px; border-radius: 2px; background: linear-gradient(180deg, #c6efff, #5d9bff); opacity: .85; }
      .dshvd-wave.live i { animation: dshvd-wave 1.1s ease-in-out infinite; transform-origin: bottom; }
      .dshvd-wave.live i:nth-child(2) { animation-delay: .12s; }
      .dshvd-wave.live i:nth-child(3) { animation-delay: .24s; }
      .dshvd-wave.live i:nth-child(4) { animation-delay: .36s; }
      .dshvd-wave.live i:nth-child(5) { animation-delay: .48s; }
      .dshvd-status { flex: 1; min-width: 0; color: #c6d3ee; font-size: 12px; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dshvd-meter { display: flex; align-items: flex-end; gap: 2px; height: 15px; opacity: .8; flex: 0 0 auto; }
      .dshvd-meter i { width: 2px; border-radius: 2px; background: linear-gradient(180deg, #b8ccff, #526fd4); }
      .dshvd-thread { display: flex; flex-direction: column; gap: 11px; margin-top: 12px; max-height: 196px; overflow: auto; padding-right: 2px; scrollbar-width: thin; scrollbar-color: rgba(130,160,220,.35) transparent; }
      .dshvd-thread::-webkit-scrollbar { width: 4px; }
      .dshvd-thread::-webkit-scrollbar-thumb { background: rgba(130,160,220,.35); border-radius: 4px; }
      .dshvd-msg { display: grid; grid-template-columns: 34px 44px minmax(0, 1fr); gap: 8px; align-items: center; }
      .dshvd-avatar { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; border: 1px solid rgba(231,199,128,.38); color: #efd28d; background: radial-gradient(circle at 40% 30%, rgba(255,225,150,.18), rgba(20,36,86,.75)); box-shadow: inset 0 0 14px rgba(231,199,128,.12), 0 0 14px rgba(50,90,210,.10); overflow: hidden; }
      .dshvd-avatar-user { border-color: rgba(231,199,128,.48); }
      .dshvd-avatar-bot { border-color: rgba(130,170,255,.55); background: #152552; }
      .dshvd-avatar-bot img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .dshvd-who { color: #e9d59f; font-size: 12px; letter-spacing: .03em; white-space: nowrap; }
      .dshvd-bubble { position: relative; min-width: 0; padding: 10px 13px; border-radius: 13px; border: 1px solid rgba(120,150,220,.22); background: linear-gradient(135deg, rgba(24,38,82,.86), rgba(14,22,50,.8)); box-shadow: inset 0 0 18px rgba(50,80,180,.12); }
      .dshvd-bubble-user { border-color: rgba(231,199,128,.22); background: linear-gradient(135deg, rgba(38,45,86,.72), rgba(18,28,62,.8)); }
      .dshvd-bubble-assistant { border-color: rgba(110,150,255,.28); background: linear-gradient(135deg, rgba(26,42,94,.92), rgba(14,23,55,.82)); }
      .dshvd-say { margin: 0; color: #e7edfb; font-size: 11.8px; line-height: 1.62; white-space: pre-wrap; word-break: break-word; max-height: 96px; overflow: auto; scrollbar-width: thin; scrollbar-color: rgba(130,160,220,.3) transparent; }
      .dshvd-spark { position: absolute; right: 9px; top: 7px; color: #f0d69a; font-size: 9px; line-height: 1; opacity: .85; }
      .dshvd-footer { margin-top: 10px; }
      .dshvd-rule-footer { margin: 10px 0 7px; }
      .dshvd-hint { display: flex; align-items: center; gap: 7px; font-size: 11px; color: rgba(190,205,235,.64); }
      .dshvd-info { color: #e2c27a; flex: 0 0 auto; }
      .dshvd-errorbox { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(120,30,40,.35); border: 1px solid rgba(255,120,120,.28); color: #ffc9c9; font-size: 11px; word-break: break-word; max-height: 96px; overflow: auto; }
      @keyframes dshvd-wave { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
      @media (max-width: 560px) { .dshvd-panel { right: 10px; bottom: 84px; width: calc(100vw - 20px); } .dshvd-model-grid { grid-template-columns: 1fr; } }
      .dshvd-settings { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
      .dshvd-models { display: flex; flex-direction: column; gap: 0; padding: 0; border: 0; background: transparent; }
      .dshvd-models-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid rgba(127,127,127,.18); border-bottom: 1px solid rgba(127,127,127,.18); }
      .dshvd-models-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .dshvd-models-heading strong { font-size: 12px; font-weight: 600; }
      .dshvd-model-ok { font-size: 11px; color: #4f8a5b; opacity: .9; }
      .dshvd-model-warn { font-size: 11px; color: #a16a28; opacity: .9; }
      .dshvd-model-toggle { border: 0; background: transparent; color: inherit; opacity: .65; font-size: 11px; cursor: pointer; padding: 2px 0; }
      .dshvd-model-toggle:hover { opacity: 1; }
      .dshvd-models-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 0 9px; }
      .dshvd-model-hint { font-size: 10px; opacity: .55; }
      .dshvd-model-grid { display: grid; grid-template-columns: minmax(180px, 1.1fr) minmax(180px, 1fr); gap: 10px; }
      .dshvd-model-checks { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
      .dshvd-model-state { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 10px; opacity: .68; }
      .dshvd-model-state span { white-space: nowrap; }
      .dshvd-progress { display: flex; flex-direction: column; gap: 4px; font-size: 10px; opacity: .82; }
      .dshvd-progress-bar { height: 4px; min-width: 2px; max-width: 100%; border-radius: 4px; background: #7fa4ff; transition: width .25s ease; }
      .dshvd-models .dshvd-check { font-size: 11px; }
      .dshvd-models .dshvd-input { width: 100%; box-sizing: border-box; }
      .dshvd-h3 { margin: 0 0 2px; font-size: 14px; }
      .dshvd-p { margin: 0; opacity: .72; line-height: 1.6; }
      .dshvd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
      .dshvd-field { display: flex; flex-direction: column; gap: 4px; }
      .dshvd-label { font-size: 11px; opacity: .72; }
      .dshvd-input { padding: 6px 8px; border: 1px solid rgba(127,127,127,.35); border-radius: 7px; background: transparent; color: inherit; font-size: 12px; min-width: 0; }
      .dshvd-check { display: flex; align-items: center; gap: 6px; grid-column: 1 / -1; }
      .dshvd-actions, .dshvd-test { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .dshvd-test .dshvd-input { flex: 1 1 240px; }
      .dshvd-action { padding: 6px 11px; border-radius: 7px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; cursor: pointer; font-size: 12px; }
      .dshvd-action:hover { background: rgba(127,127,127,.12); }
      .dshvd-action:disabled { opacity: .5; cursor: default; }
      .dshvd-hintline { font-size: 10px; opacity: .5; }
      .dshvd-voices { opacity: .72; font-size: 11px; }
      .dshvd-message { padding: 6px 8px; border-radius: 7px; background: rgba(47,158,68,.1); color: #1e7c36; }
    `

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const id = 'dsh-voice-duplex/styles'
          let tag = document.querySelector('style[data-plugin="' + id + '"]')
          let created = false
          if (!tag) {
            tag = document.createElement('style')
            tag.dataset.plugin = id
            tag.textContent = CSS
            document.head.appendChild(tag)
            created = true
          }
          return () => { if (created) tag.remove() }
        }, 'voice-duplex: styles')

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-voice-duplex-overlay',
          order: 130,
        }, () => h('div', { className: 'dshvd-overlay-root' }, h(VoiceButton))))

        // This bridge is session-scoped, but it only publishes context. The
        // actual call UI/audio lives in shell.overlay and survives the switch.
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-voice-duplex',
          order: 120,
        }, props => h(VoiceContextBridge, props)))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-voice-settings',
          order: 80,
          label: () => '语音通话',
          inject: () => ({}),
        }, SettingsPage))
      },
    }
  },
})

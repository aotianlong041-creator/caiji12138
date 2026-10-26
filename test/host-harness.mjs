import http from 'node:http'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'asr_test16.wav')
const sessionId = 'voice-test-session'
const fakeSession = {
  seq: 42,
  deriveMessages() {
    return [
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      { role: 'assistant', content: [{ type: 'text', text: '你好，我是本地语音测试回答。' }] },
    ]
  },
}

let route
const toolsByName = new Map()
const disposers = []
const eventHandlers = new Map()
const ctx = {
  logger: console,
  get() { return undefined },
  inject(_names, callback) { callback(ctx) },
  on(name, handler) {
    eventHandlers.set(name, handler)
    return () => eventHandlers.delete(name)
  },
  effect(fn) { const value = fn(); if (typeof value === 'function') disposers.push(value); return value },
  tools: {
    register(definition) {
      toolsByName.set(definition.name, definition)
      return () => { toolsByName.delete(definition.name) }
    },
  },
  deepseekAccount: {
    async getBalance() { return { status: 'ready', value: [{ currency: 'CNY', balance: '12.50' }], bonusWallets: [] } },
  },
  agentDefaultModel: {
    currentSelection() { return { provider: 'mock-provider', model: 'mock-fast', reasoningEffort: 'low' } },
  },
  llm: {
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '{"mode":"chat","reply":"后台快速回答。","instruction":"","deep":false}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  },
  webServer: {
    getOrigin() { return 'http://127.0.0.1:8899' },
    register(value) { route = value; return () => {} },
  },
  sessions: {
    get(id) { return id === sessionId ? fakeSession : undefined },
  },
  agents: {
    get(id) { return id === sessionId ? { id } : undefined },
  },
}

apply(ctx)
if (!route) throw new Error('route was not registered')

const server = http.createServer((request, response) => route.handler(request, response))

function readWav(path) {
  const buffer = fs.readFileSync(path)
  let offset = 12
  let data = -1
  let size = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readInt32LE(offset + 4)
    if (id === 'data') { data = offset + 8; size = length; break }
    offset += 8 + length + (length & 1)
  }
  if (data < 0) throw new Error('no data chunk')
  return buffer.subarray(data, data + size)
}

async function call(path, init) {
  const response = await fetch(`http://127.0.0.1:8899${path}`, init)
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return { status: response.status, json: await response.json() }
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, contentType, bytes }
}

await new Promise(resolve => server.listen(8899, '127.0.0.1', resolve))
try {
  const health = await call('/dsh-voice/health')
  console.log('HEALTH', health.status, JSON.stringify(health.json?.breeze?.ok), JSON.stringify(health.json?.breeze?.voicePresent), JSON.stringify(health.json?.breeze?.voices?.map(voice => voice.id)), JSON.stringify(health.json?.asr))

  const clock = await call('/dsh-voice/clock')
  console.log('CLOCK', clock.status, clock.json?.clock?.date, clock.json?.clock?.time, clock.json?.clock?.weekday, clock.json?.clock?.timeZone)
  if (clock.status !== 200 || !clock.json?.clock?.date || !clock.json?.clock?.time || !clock.json?.clock?.weekday) {
    throw new Error('clock route did not return local date/time/weekday')
  }

  const modelCatalog = await call('/dsh-voice/models/catalog')
  console.log('MODEL_CATALOG', modelCatalog.status, modelCatalog.json?.models?.length, modelCatalog.json?.recommended, Boolean(modelCatalog.json?.hardware))
  if (modelCatalog.status !== 200 || modelCatalog.json?.models?.length !== 4) throw new Error('model catalog is incomplete')
  const modelStatus = await call('/dsh-voice/models/status')
  console.log('MODEL_STATUS', modelStatus.status, modelStatus.json?.installed?.runtime?.installed, modelStatus.json?.installed?.voices?.installed)
  if (modelStatus.status !== 200 || !modelStatus.json?.installed) throw new Error('model status failed')

  const deniedInstall = await call('/dsh-voice/models/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelId: 'q4_k', modelDir: modelStatus.json.modelDir, acceptLicense: false }),
  })
  console.log('MODEL_LICENSE_GUARD', deniedInstall.status)
  if (deniedInstall.status !== 409) throw new Error('model license guard did not reject install')

  const clockChat = await call('/dsh-voice/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '现在几点？', sessionId }),
  })
  console.log('CLOCK_CHAT', clockChat.status, clockChat.json?.mode, clockChat.json?.reply, clockChat.json?.clock?.time)
  if (clockChat.status !== 200 || clockChat.json?.mode !== 'chat' || !String(clockChat.json?.reply || '').includes('现在')) {
    throw new Error('clock voice shortcut did not answer deterministically')
  }

  const icon = await call('/dsh-voice/assets/voice-call-on.png')
  console.log('ICON', icon.status, icon.contentType, icon.bytes?.length)

  const avatar = await call('/dsh-voice/assets/answer-avatar.png')
  console.log('AVATAR', avatar.status, avatar.contentType, avatar.bytes?.length)

  const avatar3d = await call('/dsh-voice/assets/avatar3d.mjs')
  console.log('AVATAR3D_DISABLED_ASSET', avatar3d.status)
  if (avatar3d.status !== 404) throw new Error('avatar3d asset is still served')

  const avatarManifest = await call('/dsh-voice/avatar3d/manifest')
  console.log('AVATAR3D_DISABLED_MANIFEST', avatarManifest.status)
  if (avatarManifest.status !== 404) throw new Error('avatar3d manifest route is still served')

  const business = await call(`/dsh-voice/business?sessionId=${encodeURIComponent(sessionId)}`)
  console.log('BUSINESS', business.status, business.json?.snapshot?.task?.status, business.json?.snapshot?.balance?.status)
  if (business.status !== 200) throw new Error('non-3D business route failed')

  const legacy = await call('/dsh-voice/assets/character.mjs')
  console.log('LEGACY_CHARACTER_GONE', legacy.status)

  const config = await call('/dsh-voice/config')
  const saved = await call('/dsh-voice/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config.json.config),
  })
  console.log('CONFIG', config.status, saved.status)

  const assistant = await call(`/dsh-voice/assistant?sessionId=${encodeURIComponent(sessionId)}`)
  console.log('ASSISTANT', assistant.status, JSON.stringify(assistant.json))

  const voiceChat = await call('/dsh-voice/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好，今天怎么样？', sessionId }),
  })
  console.log('VOICE_CHAT', voiceChat.status, voiceChat.json?.mode, voiceChat.json?.reply, voiceChat.json?.model, voiceChat.json?.error)

  const confirmWork = await call('/dsh-voice/confirm-work', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: '可以，去处理吧',
      instruction: '检查当前项目的代码并修复明显错误',
      sessionId,
    }),
  })
  console.log('CONFIRM_WORK', confirmWork.status, confirmWork.json?.decision, confirmWork.json?.confidence)
  if (confirmWork.status !== 200 || confirmWork.json?.decision !== 'unclear') {
    throw new Error('confirmation route did not fail safe on a non-confirmation mock response')
  }


  eventHandlers.get('session/event')?.({ id: sessionId }, { type: 'approval/asked', data: {} })
  const approvalSnapshot = await call(`/dsh-voice/business?sessionId=${encodeURIComponent(sessionId)}`)
  console.log('APPROVAL_TASK', approvalSnapshot.status, approvalSnapshot.json?.snapshot?.task?.status)

  const perf = await call('/dsh-voice/character/perf')
  const perfReport = await call('/dsh-voice/character/perf/report')
  console.log('CHAR_PERF_DISABLED', perf.status, perfReport.status)
  if (perf.status !== 404 || perfReport.status !== 404) throw new Error('3D perf routes are still served')

  const pcm = readWav(fixture)
  const asr = await call('/dsh-voice/asr', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pcm: pcm.toString('base64'), sampleRate: 16000 }),
  })
  console.log('ASR', asr.status, JSON.stringify(asr.json))

  const ttsStart = Date.now()
  const tts = await call('/dsh-voice/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '语音插件宿主路由测试。' }),
  })
  console.log('TTS', tts.status, tts.contentType, tts.bytes?.length, 'totalMs=' + (Date.now() - ttsStart))
  if (tts.bytes) fs.writeFileSync(join(tmpdir(), 'plugin-tts.wav'), tts.bytes)

  const streamStart = Date.now()
  const configuredVoice = config.json?.config?.voiceId
  const streamResponse = await fetch('http://127.0.0.1:8899/dsh-voice/tts-stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好，我是鲸鱼娘，现在测试流式播放的连续性和噪音。', voice: 'stale-browser-voice' }),
  })
  const streamVoice = streamResponse.headers.get('x-voice-id')
  const streamReader = streamResponse.body.getReader()
  let streamBytes = 0
  let firstChunkMs = 0
  let streamChunks = 0
  let oddChunks = 0
  while (true) {
    const { done, value } = await streamReader.read()
    if (done) break
    if (!firstChunkMs) firstChunkMs = Date.now() - streamStart
    streamBytes += value.byteLength
    streamChunks += 1
    if (value.byteLength % 2 !== 0) oddChunks += 1
  }
  console.log('TTS_STREAM', streamResponse.status, streamResponse.headers.get('content-type'), streamResponse.headers.get('x-sample-rate'), streamBytes, 'firstChunkMs=' + firstChunkMs, 'totalMs=' + (Date.now() - streamStart), 'chunks=' + streamChunks, 'odd=' + oddChunks, 'voice=' + streamVoice, 'configVoice=' + configuredVoice)
  if (streamVoice !== configuredVoice) throw new Error(`saved voice was not authoritative: ${streamVoice} != ${configuredVoice}`)
} finally {
  for (const dispose of disposers) { try { await dispose() } catch {} }
  server.close()
}

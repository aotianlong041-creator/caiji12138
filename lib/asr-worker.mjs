/**
 * Isolated SenseVoice ASR worker. Reads JSON lines on stdin and writes one
 * JSON result line per request. It is deliberately a child process: model
 * loading and ONNX inference cannot stall the DSH Host event loop.
 */
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'

const require = createRequire(import.meta.url)

function fatal(error) {
  try {
    process.stdout.write(JSON.stringify({ type: 'fatal', error: error instanceof Error ? error.message : String(error) }) + '\n')
  } catch {}
  process.exitCode = 1
}

function resample(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) return samples
  const out = new Float32Array(Math.max(1, Math.round(samples.length * targetRate / sourceRate)))
  for (let i = 0; i < out.length; i += 1) {
    const position = i * sourceRate / targetRate
    const left = Math.floor(position)
    const right = Math.min(samples.length - 1, left + 1)
    const fraction = position - left
    out[i] = samples[left] * (1 - fraction) + samples[right] * fraction
  }
  return out
}

function main() {
  const [model, tokens, language = 'auto', threads = '2'] = process.argv.slice(2)
  if (!model || !tokens) throw new Error('usage: asr-worker.mjs <model.onnx> <tokens.txt> [language] [threads]')

  const sherpa = require('sherpa-onnx-node')
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model,
        language: language === 'auto' ? 'auto' : language,
        useInverseTextNormalization: 1,
      },
      tokens,
      numThreads: Math.max(1, Math.min(8, Number(threads) || 2)),
      provider: 'cpu',
      debug: 0,
    },
  })

  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n')

  const lines = createInterface({ input: process.stdin })
  lines.on('line', line => {
    let request
    try {
      request = JSON.parse(line)
    } catch {
      return
    }
    const id = request?.id
    try {
      const pcm = Buffer.from(String(request?.pcm || ''), 'base64')
      if (pcm.length < 2 || pcm.length % 2 !== 0) throw new Error('invalid PCM payload')
      const samples = new Float32Array(pcm.length / 2)
      for (let i = 0; i < samples.length; i += 1) samples[i] = pcm.readInt16LE(i * 2) / 32768
      const target = resample(samples, Number(request?.sampleRate) || 16000, 16000)
      const stream = recognizer.createStream()
      stream.acceptWaveform({ sampleRate: 16000, samples: target })
      recognizer.decode(stream)
      const result = recognizer.getResult(stream)
      process.stdout.write(JSON.stringify({ type: 'result', id, ok: true, text: result?.text ?? '' }) + '\n')
    } catch (error) {
      process.stdout.write(JSON.stringify({ type: 'result', id, ok: false, error: error instanceof Error ? error.message : String(error) }) + '\n')
    }
  })
  lines.on('close', () => {
    process.exit(0)
  })
}

try {
  main()
} catch (error) {
  fatal(error)
}

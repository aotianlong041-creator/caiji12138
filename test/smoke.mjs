import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/asr-worker.mjs',
  'client.js',
  'assets/answer-avatar.png',
  'assets/voice-call-on.png',
  'assets/voice-call-off.png',
  'node_modules/sherpa-onnx-node/package.json',
]
for (const relative of required) {
  const path = join(root, relative)
  if (!existsSync(path)) throw new Error(`missing: ${path}`)
}
const modelFiles = [
  process.env.ASR_MODEL_PATH,
  process.env.ASR_TOKENS_PATH,
].filter(Boolean)
for (const path of modelFiles) {
  if (!existsSync(path)) throw new Error(`missing ASR model: ${path}`)
}
if (modelFiles.length === 0) console.log('smoke: ASR model checks skipped (set ASR_MODEL_PATH / ASR_TOKENS_PATH to check)')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (!packageJson.dsh?.bundle?.patch) throw new Error('missing dsh.bundle.patch')
if (packageJson.dsh?.client?.platform !== 'web') throw new Error('missing web client')
console.log('dsh-voice-duplex smoke: files, manifest and optional local models present')

import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ASR_ASSETS,
  BREEZE_RUNTIME,
  MODEL_VARIANTS,
  asrPaths,
  defaultModelDir,
  installedState,
  modelPath,
  runtimePath,
} from '../lib/models.js'

test('Breeze model catalog has four verified variants', () => {
  assert.equal(MODEL_VARIANTS.length, 4)
  for (const variant of MODEL_VARIANTS) {
    assert.match(variant.sha256, /^[0-9a-f]{64}$/)
    assert.ok(variant.bytes > 2_000_000_000)
    assert.ok(variant.file.endsWith('.gguf'))
  }
  assert.equal(BREEZE_RUNTIME.sha256, 'd31feee5380e0609dc44b537d22cbe4f3cf8e93495756f3a580d8b448db79f7f')
  assert.equal(ASR_ASSETS.model.sha256, 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51')
})

test('model paths stay under the selected model directory', () => {
  const root = 'C:\\models\\voice'
  assert.equal(modelPath(root, 'q4_k'), join(root, 'breeze-tts-2-q4_k.gguf'))
  assert.equal(runtimePath(root), join(root, 'breeze-v0.1.3-win32-x64'))
  assert.equal(asrPaths(root).tokens, join(root, 'asr', 'tokens.txt'))
  assert.equal(defaultModelDir('C:\\dsh'), join('C:\\dsh', 'voice-models'))
})

test('bundled voice library is present', () => {
  const voices = join(process.cwd(), 'assets', 'voices')
  assert.equal(existsSync(voices), true)
  const files = readdirSync(voices).filter(name => name.endsWith('.breeze'))
  assert.ok(files.length >= 15, `expected 15 bundled voices, got ${files.length}`)
  assert.ok(files.includes('dafeiyu.breeze'))
})

test('installedState reports missing dependencies without downloading', () => {
  const state = installedState(join('C:', 'missing-voice-models'), join(process.cwd(), 'assets', 'voices'))
  assert.equal(state.runtime.installed, false)
  assert.equal(state.asr.model.installed, false)
  assert.equal(state.models.length, 4)
  assert.equal(state.voices.installed, true)
})

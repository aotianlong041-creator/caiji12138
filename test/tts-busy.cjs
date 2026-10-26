const path = require('path')

global.window = {
  __ModuleLoader__: {
    load(definition) {
      if (definition && typeof definition.factory === 'function') {
        global.__voiceModule = definition.factory(require)
      }
    },
  },
  setTimeout,
  clearTimeout,
}
require(path.join(__dirname, '..', 'client.js'))
const busy = global.window.__dshVoiceIsBreezeBusy
if (typeof busy !== 'function') throw new Error('isBreezeBusy test seam missing')

const cases = [
  [409, '', true],
  [429, '', true],
  [500, '{"error":{"message":"busy, another generation is running"}}', true],
  [500, 'another generation is running', true],
  [400, 'invalid text', false],
  [500, 'internal error', false],
  [200, '', false],
]
for (const [status, body, expected] of cases) {
  const actual = busy(status, body)
  if (actual !== expected) {
    console.error('BUSY_FAIL', JSON.stringify({ status, body, expected, actual }))
    process.exit(1)
  }
}
console.log('TTS_BUSY_OK', cases.length)

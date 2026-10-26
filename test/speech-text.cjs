const path = require('path')

global.window = {
  __ModuleLoader__: {
    load(definition) {
      if (definition && typeof definition.factory === 'function') {
        global.__voiceModule = definition.factory(require)
      }
    },
  },
}
require(path.join(__dirname, '..', 'client.js'))
const strip = global.window.__dshVoiceStripForSpeech
const speech = global.window.__dshVoiceSpeechText
if (typeof strip !== 'function') throw new Error('stripForSpeech test seam missing')
if (typeof speech !== 'function') throw new Error('speechText test seam missing')

const cases = [
  ['（尾鳍摆摆）主人好。', '主人好。'],
  ['你好。（尾鳍摆摆）', '你好。'],
  ['这是（动作）内容', '这是 内容'],
  ['（外层（内层））收到', '收到'],
  ['(soft smile) 好的', '好的'],
  ['【动作】知道了', '知道了'],
  ['[挥手] 嗯', '嗯'],
  ['看看[文档](https://example.com)吧', '看看文档吧'],
  ['回复：这是正常台词。', '这是正常台词。'],
  ['"reply": "这是正常台词。"', '这是正常台词。'],
  ['mode: chat\nvoice_direction: 轻松\n这是正常台词。', '这是正常台词。'],
]

const structuredCases = [
  [
    '{"mode":"chat","reply":"好，先看看哪里出了问题。","voice_direction":"语调平稳","instruction":"","deep":false}',
    '好，先看看哪里出了问题。',
  ],
  [
    '```json\n{"mode":"chat","reply":"（甩甩尾鳍）交给我吧。","voice_direction":"轻松","instruction":"","deep":false}\n```',
    '交给我吧。',
  ],
  [
    '{"mode":"chat","reply":"先别急着改代码。","voice_direction":"放慢语速，停一下","instruction":"","deep":false}',
    '先别急着改代码。',
  ],
  [
    '{"mode":"chat","reply":"","voice_direction":"","instruction":"","deep":false}',
    '',
  ],
]

for (const [input, expected] of cases) {
  const actual = strip(input)
  if (actual !== expected) {
    console.error('STRIP_FAIL', JSON.stringify({ input, expected, actual }))
    process.exit(1)
  }
  if (/[（）()【】\[\]]/.test(actual)) {
    console.error('BRACKET_LEFT', JSON.stringify({ input, actual }))
    process.exit(1)
  }
}

for (const [input, expected] of structuredCases) {
  const actual = strip(speech(input))
  if (actual !== expected) {
    console.error('JSON_SPEECH_FAIL', JSON.stringify({ input, expected, actual }))
    process.exit(1)
  }
  if (/\{|\}|"mode"|"reply"|voice_direction|instruction|deep/.test(actual)) {
    console.error('JSON_LEAK', JSON.stringify({ input, actual }))
    process.exit(1)
  }
}

console.log('SPEECH_STRIP_OK', cases.length + structuredCases.length)

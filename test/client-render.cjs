const fs = require('fs')
const path = require('path')

const registrations = []
const styleTags = []
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
  setInterval,
  clearInterval,
}
global.document = {
  querySelector() { return null },
  createElement(tag) { return { tag, dataset: {}, textContent: '', remove() {} } },
  head: { appendChild(node) { styleTags.push(node) } },
}
global.Audio = class FakeAudio {
  constructor() { this.onended = null; this.onerror = null }
  play() { return Promise.resolve() }
  pause() {}
}

require(path.join(__dirname, '..', 'client.js'))

const mod = global.__voiceModule
if (!mod) throw new Error('client factory did not run')
const ctx = {
  effect(fn) { const value = fn(); return value },
  slots: {
    inject(_name, callback) {
      const value = callback()
      if (value && value.spec && value.component) registrations.push(value)
      return () => {}
    },
    register(spec, component) { return { spec, component } },
  },
}
mod.apply(ctx)

const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const voice = registrations.find(item => item.spec.name === 'shell.overlay')
const bridge = registrations.find(item => item.spec.name === 'conversation.input.right')
const settings = registrations.find(item => item.spec.name === 'settings.section')
if (!voice) throw new Error('voice overlay slot was not registered')
if (!bridge) throw new Error('voice context bridge slot was not registered')
if (!settings) throw new Error('settings slot was not registered')

const html = renderToStaticMarkup(React.createElement(voice.component, {}))
console.log('VOICE_HTML', html.slice(0, 500))
if (!html.includes('dshvd-btn')) throw new Error('voice button did not render')

const settingsHtml = renderToStaticMarkup(React.createElement(settings.component, {}))
console.log('SETTINGS_HTML', settingsHtml.slice(0, 300))
if (!settingsHtml.includes('语音通话') && !settingsHtml.includes('正在读取配置')) throw new Error('settings page did not render')

console.log('CLIENT_RENDER_OK', registrations.length, styleTags.length)

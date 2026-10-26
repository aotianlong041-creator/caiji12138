import assert from 'node:assert/strict'
import test from 'node:test'
import { clockAnswerFor, clockSnapshot, looksLikeClockQuestion } from '../lib/clock.js'

const shanghaiNoon = new Date('2026-10-26T03:35:12.000Z')

test('clockSnapshot exposes local date, time, weekday and timezone', () => {
  const clock = clockSnapshot(shanghaiNoon, 'Asia/Shanghai')
  assert.equal(clock.date, '2026-10-26')
  assert.equal(clock.time, '11:35:12')
  assert.equal(clock.weekday, '星期一')
  assert.equal(clock.timeZone, 'Asia/Shanghai')
  assert.match(clock.line, /2026-10-26 星期一 11:35:12/)
})

test('clock answers are deterministic and include all requested fields', () => {
  const answer = clockAnswerFor('现在几点？', clockSnapshot(shanghaiNoon, 'Asia/Shanghai'))
  assert.ok(answer)
  assert.equal(answer.mode, 'chat')
  assert.match(answer.reply, /2026年10月26日/)
  assert.match(answer.reply, /星期一/)
  assert.match(answer.reply, /11点35分/)
  assert.equal(answer.instruction, '')
})

test('clock intent only captures direct clock questions', () => {
  for (const text of ['现在几点', '几点了呀？', '今天几号', '今天星期几', '现在是什么时间', 'what time is it']) {
    assert.equal(looksLikeClockQuestion(text), true, text)
  }
  for (const text of ['现在适合看什么', '现在几点，顺便帮我改代码', '今天好累']) {
    assert.equal(looksLikeClockQuestion(text), false, text)
  }
})

/**
 * 大肥鱼的内置本地钟表。
 *
 * 只读取宿主本地时间，不写入状态。所有显示字段都由同一个 `Intl`
 * formatter 生成，避免日期、时分和星期来自不同时间点。
 */

const DEFAULT_TIME_ZONE = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local'
  } catch {
    return 'Local'
  }
}

const CLOCK_QUESTION_PATTERNS = [
  /^(现在|当前)?(是)?(几点|几点了|什么时间|啥时候|什么时候|时间是多少|时间)(了|啊|呀|呢)?$/,
  /^(今天|现在)?(是)?(几号|几日|几月几号|几月几日|什么日期|日期|星期几|礼拜几|周几)(啊|呀|呢|了)?$/,
  /^(whattimeisit|whattime|whatisthetime|currenttime|whatsthetime|whatdate|whatday|today'sdate|todaysdate)$/i,
]

export function clockSnapshot(now = new Date(), timeZone = DEFAULT_TIME_ZONE()) {
  const instant = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(instant.getTime())) throw new Error('clockSnapshot: invalid date')
  let parts
  try {
    parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
  } catch {
    // A malformed TZ should not take down the voice route. Fall back to local
    // wall-clock fields, still using the same instant.
    parts = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
    timeZone = DEFAULT_TIME_ZONE()
  }
  const pick = type => parts.find(part => part.type === type)?.value ?? ''
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  const weekday = pick('weekday')
  const hour = pick('hour')
  const minute = pick('minute')
  const second = pick('second')
  const date = `${year}-${month}-${day}`
  const time = `${hour}:${minute}:${second}`
  const line = `${date} ${weekday} ${time}（${timeZone}）`
  return {
    iso: instant.toISOString(),
    timeZone,
    date,
    time,
    weekday,
    hour,
    minute,
    second,
    line,
    spoken: `现在是${Number(year)}年${Number(month)}月${Number(day)}日，${weekday}，${Number(hour)}点${minute}分。`,
  }
}

export function looksLikeClockQuestion(text) {
  const clean = String(text || '')
    .replace(/[，。！？!?、,.…：:；;\s"'“”‘’]/g, '')
    .replace(/^(大肥鱼|请问|那个|喂)/, '')
    .trim()
  if (!clean) return false
  return CLOCK_QUESTION_PATTERNS.some(pattern => pattern.test(clean))
}

export function clockAnswerFor(text, snapshot = clockSnapshot()) {
  if (!looksLikeClockQuestion(text)) return null
  return {
    mode: 'chat',
    reply: snapshot.spoken,
    voiceDirection: '像顺手看了一眼钟表后自然回答，语速平稳，日期和时间数字清楚，不拖长音，也不加多余寒暄。',
    instruction: '',
    deep: false,
    clock: snapshot,
  }
}

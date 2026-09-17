export const CATEGORY_EMOJI = ['🎬', '🧩', '🔎', '🎨', '📝', '📅', '⚙️', '💬']

export const SYSTEM_PROMPT = `你是 DeepSeek Harness 会话标题编辑器。只依据输入 JSON 返回一个 JSON 对象，不调用工具，不输出其它文字。

标题结构：一个类别 emoji + 空格 + 对象 + 全角分隔符「｜」+ 核心目标。恰好一个「｜」，两侧非空；不要使用半角竖线、斜线或破折号代替。
类别按持续产物或对象选择：🎬内容制作、🧩工具开发、🔎对比调研、🎨页面设计、📝方法整理、📅日程安排、⚙️环境配置、💬一般讨论。emoji 只出现一个。
对象具体且稳定，目标表达持续主线；不要把最后一句“继续、测试、提交、推送、截图”单独当成新主线。旧标题格式不对时允许迁移；已有标题准确时返回 keep 并原样保留。
根据最近几轮用户消息的主导语言命名，保留产品名、工具名、模型名和代码标识符。project_hint 只是弱线索，默认不要重复；conflicting_titles 中的完整标题不要重复，证据不足时 keep。
标题总长不超过 48 个 Unicode 字符；不得输出换行、Markdown、引号、绝对路径、密钥、邮箱、电话、网址或任务完成宣称。
只输出 JSON 对象，字段为 action、title、reason；action 只能是 keep 或 rename。`

export function cleanText(value) {
  if (typeof value !== 'string') return ''
  let out = ''
  for (const ch of value) {
    const cp = ch.codePointAt(0)
    if (cp < 32 || (cp >= 127 && cp <= 159)) continue
    if ((cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff) continue
    out += ch
  }
  return out.replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('\t', ' ').split(' ').filter(Boolean).join(' ').trim()
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).length
}

export function normalizeTitle(value, maxBytes = 80) {
  const text = cleanText(value)
  if (utf8Bytes(text) <= maxBytes) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const size = utf8Bytes(ch)
    if (used + size > maxBytes) break
    out += ch
    used += size
  }
  return out.trimEnd()
}

export function validateTitle(value) {
  if (typeof value !== 'string') return false
  const title = cleanText(value)
  const length = Array.from(title).length
  if (length < 4 || length > 48) return false
  let emoji = ''
  for (const candidate of CATEGORY_EMOJI) {
    if (title.startsWith(`${candidate} `)) {
      emoji = candidate
      break
    }
  }
  if (!emoji) return false
  const body = title.slice(emoji.length + 1)
  const divider = body.indexOf('｜')
  if (divider <= 0 || divider !== body.lastIndexOf('｜') || divider >= body.length - 1) return false
  if (body.includes('|') || body[divider - 1] === ' ' || body[divider + 1] === ' ') return false
  for (const category of CATEGORY_EMOJI) {
    if (body.includes(category)) return false
  }
  if (title.includes('http://') || title.includes('https://') || title.includes('/Users/') || title.includes('sk-') || title.includes('-----BEGIN')) return false
  if (title.includes('`') || title.includes('"')) return false
  return true
}

export function parseModelResult(raw) {
  if (typeof raw !== 'string') return null
  let text = raw.trim()
  if (text.startsWith('```')) {
    const first = text.indexOf('\n')
    if (first >= 0) text = text.slice(first + 1)
    const last = text.lastIndexOf('```')
    if (last >= 0) text = text.slice(0, last).trim()
  }
  try {
    return JSON.parse(text)
  } catch {}
  const left = text.indexOf('{')
  const right = text.lastIndexOf('}')
  if (left >= 0 && right > left) {
    try {
      return JSON.parse(text.slice(left, right + 1))
    } catch {}
  }
  return null
}

export function createTextAssembler() {
  const parts = new Map()
  const order = []
  const closed = new Set()
  let finishReason

  function partFor(index) {
    if (!parts.has(index)) {
      parts.set(index, '')
      order.push(index)
    }
    return parts.get(index)
  }

  return {
    push(chunk) {
      if (!chunk || typeof chunk !== 'object') return
      if (chunk.type === 'text-delta') {
        const current = partFor(chunk.index)
        if (!closed.has(chunk.index) && typeof chunk.text === 'string') parts.set(chunk.index, current + chunk.text)
        return
      }
      if (chunk.type === 'block-end') {
        if (chunk.block?.type === 'tool-call') throw new Error('title model requested a tool')
        const current = partFor(chunk.index)
        if (!closed.has(chunk.index) && current === '' && chunk.block?.type === 'text') parts.set(chunk.index, chunk.block.text || '')
        closed.add(chunk.index)
        return
      }
      if (chunk.type === 'finish') finishReason = chunk.reason
    },
    finish() {
      return {
        text: order.map(index => parts.get(index) || '').join(' ').trim(),
        finish: finishReason || { kind: 'stop' },
      }
    },
  }
}

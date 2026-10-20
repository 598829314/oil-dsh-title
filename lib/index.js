import { randomUUID } from 'node:crypto'

import { SYSTEM_PROMPT, cleanText, createTextAssembler, normalizeTitle, parseModelResult, validateTitle } from './core.js'

const name = 'oil-dsh-title'
const inject = ['sessionTitle', 'llm', 'sessions']
const TITLE_TIMEOUT_MS = 60_000
const DEBOUNCE_MS = 600

function resolveOptions(config) {
  const source = config && typeof config === 'object' ? config : {}
  const debounceMs = typeof source.debounceMs === 'number' && source.debounceMs >= 0 ? Math.floor(source.debounceMs) : DEBOUNCE_MS
  const respectManualTitles = typeof source.respectManualTitles === 'boolean' ? source.respectManualTitles : true
  return { debounceMs, respectManualTitles }
}

function routeFromSession(session) {
  try {
    const header = session.requestHeader?.()
    const config = header?.config
    if (config?.provider && config?.model) return { provider: config.provider, model: config.model }
  } catch {}
  return undefined
}

function projectHint(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  const parts = cwd.split('/').filter(Boolean)
  const name = parts.at(-1) || ''
  const ignored = new Set(['desktop', 'documents', 'downloads', 'tmp', 'temp', 'project', 'projects', 'users', 'home', 'workspace'])
  if (!name || ignored.has(name.toLowerCase())) return ''
  return name.slice(0, 64)
}

function conflictingTitles(ctx, session) {
  const titles = new Set()
  try {
    for (const other of ctx.sessions.list()) {
      if (other.id === session.id) continue
      try {
        const snapshot = ctx.sessionTitle.get(other)
        if (typeof snapshot?.title === 'string' && snapshot.title.trim()) titles.add(snapshot.title)
      } catch {}
    }
  } catch {}
  return [...titles].slice(0, 16)
}

function recentUserMessages(session) {
  const messages = []
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const text = (Array.isArray(event.data.content) ? event.data.content : [])
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
    const cleaned = cleanText(text)
    if (cleaned) messages.push({ seq: event.seq, text: cleaned.slice(0, 600) })
  }
  return messages.slice(-5)
}

async function generateTitle(ctx, route, input, sessionId, signal) {
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: JSON.stringify(input) }],
    source: { kind: 'plugin', plugin: name },
  }
  const stream = ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [message],
    system: SYSTEM_PROMPT,
    maxTokens: 256,
    purpose: 'session-title',
    sessionId,
    signal,
  })
  const assembler = createTextAssembler()
  for await (const chunk of stream) assembler.push(chunk)
  const result = assembler.finish()
  if (result.finish.kind !== 'stop') throw new Error(`title stream finished with ${result.finish.kind}`)
  if (!result.text) throw new Error('title stream returned no text')
  return result.text
}

function logFailure(ctx, phase) {
  try {
    ctx.logger?.debug?.(`oil-dsh-title: ${phase} skipped`)
  } catch {}
}

function apply(ctx, config) {
  const options = resolveOptions(config)
  const pending = new Set()
  const timers = new Map()
  const inFlight = new Set()
  const controllers = new Map()
  const handledSeq = new Map()
  const writtenTitles = new Set()
  let stopped = false

  function clearTimer(sessionId) {
    const timer = timers.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    timers.delete(sessionId)
  }

  async function update(session, suppliedRoute) {
    if (stopped || !session || inFlight.has(session.id)) return
    inFlight.add(session.id)
    const controller = new AbortController()
    controllers.set(session.id, controller)
    const timeout = setTimeout(() => controller.abort(new Error('oil-dsh-title timeout')), TITLE_TIMEOUT_MS)
    try {
      const messages = recentUserMessages(session)
      const route = suppliedRoute || routeFromSession(session)
      if (messages.length === 0 || !route) {
        logFailure(ctx, 'missing input or route')
        return
      }
      // 同一批用户消息只评估一次：debounce 合并连续事件，
      // request/header 与 user/message 也可能指向同一批消息。
      const newestSeq = messages.at(-1).seq
      if (handledSeq.get(session.id) === newestSeq) {
        logFailure(ctx, 'duplicate message batch')
        return
      }
      let snapshot
      try {
        snapshot = ctx.sessionTitle.get(session)
      } catch {}
      const currentTitle = typeof snapshot?.title === 'string' ? snapshot.title : ''
      // 用户手动把标题改成不符合「emoji 对象｜目标」的自由文本时，视为明确固定：
      // 记录已处理批次后直接跳过，避免下一轮又被自动改名覆盖。
      if (options.respectManualTitles && snapshot?.source?.kind === 'user') {
        const manualTitle = currentTitle.trim()
        if (manualTitle && !writtenTitles.has(manualTitle) && !validateTitle(manualTitle)) {
          handledSeq.set(session.id, newestSeq)
          logFailure(ctx, 'manual title pinned')
          return
        }
      }
      const input = {
        current_title: currentTitle,
        project_hint: projectHint(session.header?.cwd),
        conflicting_titles: conflictingTitles(ctx, session),
        user_messages: messages,
      }
      let raw
      try {
        raw = await generateTitle(ctx, route, input, session.id, controller.signal)
      } catch {
        logFailure(ctx, 'model generation')
        return
      }
      if (stopped || controller.signal.aborted) return
      const parsed = parseModelResult(raw)
      let action = 'keep'
      let candidate = ''
      if (parsed && typeof parsed === 'object') {
        if (parsed.action === 'rename' || parsed.action === 'keep') action = parsed.action
        if (typeof parsed.title === 'string') candidate = parsed.title
      } else if (validateTitle(raw)) {
        action = 'rename'
        candidate = raw
      }
      handledSeq.set(session.id, newestSeq)
      if (action !== 'rename') return
      const title = normalizeTitle(candidate)
      if (!validateTitle(title) || title === currentTitle) return
      if (conflictingTitles(ctx, session).includes(title)) return
      if (ctx.sessions.get(session.id) !== session) return
      try {
        ctx.sessionTitle.rename(session, title)
        writtenTitles.add(title)
      } catch {
        logFailure(ctx, 'rename')
      }
    } finally {
      clearTimeout(timeout)
      controllers.delete(session.id)
      inFlight.delete(session.id)
    }
  }

  function schedule(session, route, delay = options.debounceMs) {
    if (stopped || !session) return
    clearTimer(session.id)
    const timer = setTimeout(() => {
      timers.delete(session.id)
      update(session, route).catch(() => logFailure(ctx, 'scheduled update'))
    }, delay)
    if (typeof timer?.unref === 'function') timer.unref()
    timers.set(session.id, timer)
  }

  ctx.effect(() => () => {
    stopped = true
    pending.clear()
    for (const sessionId of [...timers.keys()]) clearTimer(sessionId)
    for (const controller of controllers.values()) controller.abort(new Error('oil-dsh-title stopped'))
    controllers.clear()
    handledSeq.clear()
    writtenTitles.clear()
  }, 'oil-dsh-title teardown')

  ctx.on('session/event', (session, event) => {
    if (stopped || !session || !event) return
    if (event.type === 'user/message') {
      if (event.data?.source?.kind !== 'user') return
      pending.add(session.id)
      const route = routeFromSession(session)
      if (route) schedule(session, route)
      return
    }
    if (event.type !== 'request/header' || !pending.has(session.id)) return
    pending.delete(session.id)
    const config = event.data?.header?.config
    if (config?.provider && config?.model) schedule(session, { provider: config.provider, model: config.model })
  })
}

export { apply, inject, name }

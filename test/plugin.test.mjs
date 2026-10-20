import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'

const OPTIONS = { debounceMs: 0 }
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

function createHarness({ streamText = '{"action":"rename","title":"🧩 DSH插件｜验证自动改名"}', initialTitle = { title: '旧标题' }, events } = {}) {
  const state = { listener: undefined, cleanup: undefined, renamed: [], calls: 0 }
  const session = {
    id: 'session-test',
    header: { cwd: '/tmp/oil-dsh-title' },
    requestHeader: () => ({ config: { provider: 'test-provider', model: 'test-model' } }),
    snapshotEvents: () => events ?? [{
      seq: 1,
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: '请验证 DSH 标题插件的事件监听和自动改名。' }],
      },
    }],
  }
  let title = initialTitle
  const ctx = {
    sessionTitle: {
      get: () => title,
      rename: (_session, value) => {
        state.renamed.push(value)
        title = { title: value, source: { kind: 'user' } }
      },
    },
    llm: {
      stream: async function* () {
        state.calls += 1
        yield { type: 'block-end', index: 0, block: { type: 'text', text: streamText } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    sessions: {
      list: () => [session],
      get: id => (id === session.id ? session : undefined),
    },
    on: (_event, handler) => { state.listener = handler },
    effect: factory => { state.cleanup = factory() },
    logger: { debug: () => {} },
  }
  return { state, session, ctx }
}

test('renames a live session after user/message and request/header', async () => {
  const { state, session, ctx } = createHarness()
  apply(ctx, OPTIONS)
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  state.listener(session, { type: 'request/header', data: { header: { config: { provider: 'test-provider', model: 'test-model' } } } })
  await settle()
  assert.deepEqual(state.renamed, ['🧩 DSH插件｜验证自动改名'])
  assert.equal(state.calls, 1)
  state.cleanup?.()
})

test('debounce 合并同一批消息，避免重复调用模型', async () => {
  const { state, session, ctx } = createHarness()
  apply(ctx, OPTIONS)
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  state.listener(session, { type: 'request/header', data: { header: { config: { provider: 'test-provider', model: 'test-model' } } } })
  await settle()
  assert.equal(state.calls, 1)
  assert.deepEqual(state.renamed, ['🧩 DSH插件｜验证自动改名'])
  state.cleanup?.()
})

test('同一批消息的后续事件不会再次评估', async () => {
  const { state, session, ctx } = createHarness()
  apply(ctx, OPTIONS)
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  await settle()
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  state.listener(session, { type: 'request/header', data: { header: { config: { provider: 'test-provider', model: 'test-model' } } } })
  await settle()
  assert.equal(state.calls, 1)
  state.cleanup?.()
})

test('用户手动改出的自由标题被视为固定，不再被覆盖', async () => {
  const { state, session, ctx } = createHarness({ initialTitle: { title: '我自己起的名字', source: { kind: 'user' } } })
  apply(ctx, OPTIONS)
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  await settle()
  assert.deepEqual(state.renamed, [])
  assert.equal(state.calls, 0)
  state.cleanup?.()
})

test('插件自己写过的标题仍可继续演进', async () => {
  const events = [{
    seq: 1,
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '请验证 DSH 标题插件的事件监听和自动改名。' }] },
  }]
  const { state, session, ctx } = createHarness({
    events,
    initialTitle: { title: '🧩 DSH插件｜旧目标', source: { kind: 'user' } },
  })
  apply(ctx, OPTIONS)
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  await settle()
  assert.deepEqual(state.renamed, ['🧩 DSH插件｜验证自动改名'])

  events.push({
    seq: 2,
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续补充一轮需求。' }] },
  })
  state.listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  await settle()
  assert.equal(state.calls, 2)
  state.cleanup?.()
})

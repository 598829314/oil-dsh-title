import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'

test('renames a live session after user/message and request/header', async () => {
  let listener
  let cleanup
  let renamed
  const session = {
    id: 'session-test',
    header: { cwd: '/tmp/oil-dsh-title' },
    requestHeader: () => ({ config: { provider: 'test-provider', model: 'test-model' } }),
    snapshotEvents: () => [{
      seq: 1,
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: '请验证 DSH 标题插件的事件监听和自动改名。' }],
      },
    }],
  }
  let title = { title: '旧标题' }
  const ctx = {
    sessionTitle: {
      get: () => title,
      rename: (_session, value) => {
        renamed = value
        title = { title: value }
      },
    },
    llm: {
      stream: async function* () {
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"action":"rename","title":"🧩 DSH插件｜验证自动改名"}' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    sessions: {
      list: () => [session],
      get: id => id === session.id ? session : undefined,
    },
    on: (_event, handler) => { listener = handler },
    effect: factory => { cleanup = factory() },
    logger: { debug: () => {} },
  }

  apply(ctx)
  listener(session, { type: 'user/message', data: { source: { kind: 'user' } } })
  listener(session, { type: 'request/header', data: { header: { config: { provider: 'test-provider', model: 'test-model' } } } })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(renamed, '🧩 DSH插件｜验证自动改名')
  cleanup?.()
})

import test from 'node:test'
import assert from 'node:assert/strict'

import { createTextAssembler, normalizeTitle, parseModelResult, validateTitle } from '../lib/core.js'

test('accepts the oil title structure and rejects unsafe output', () => {
  assert.equal(validateTitle('🧩 DSH插件｜验证自动改名'), true)
  assert.equal(validateTitle('🧩 DSH插件｜验证｜重复分隔符'), false)
  assert.equal(validateTitle('🧩 DSH插件｜https://example.com'), false)
  assert.equal(validateTitle('DSH插件｜缺少类别'), false)
})

test('normalizes whitespace and enforces the UTF-8 byte boundary', () => {
  assert.equal(normalizeTitle('🧩   DSH插件\n｜\t验证自动改名'), '🧩 DSH插件｜验证自动改名')
  assert.ok(new TextEncoder().encode(normalizeTitle('🧩 ' + '中文'.repeat(100))).length <= 80)
})

test('parses fenced and embedded JSON model output', () => {
  const result = parseModelResult('```json\n{"action":"rename","title":"🧩 DSH插件｜验证自动改名"}\n```')
  assert.deepEqual(result, { action: 'rename', title: '🧩 DSH插件｜验证自动改名' })
  assert.deepEqual(parseModelResult('prefix {"action":"keep","title":"旧标题"} suffix'), { action: 'keep', title: '旧标题' })
})

test('assembles both text-delta and block-end output without duplication', () => {
  const deltaAssembler = createTextAssembler()
  deltaAssembler.push({ type: 'text-delta', index: 0, text: '{"action":"rename"}' })
  deltaAssembler.push({ type: 'block-end', index: 0, block: { type: 'text', text: '{"action":"rename"}' } })
  deltaAssembler.push({ type: 'finish', reason: { kind: 'stop' } })
  assert.equal(deltaAssembler.finish().text, '{"action":"rename"}')

  const finalBlockAssembler = createTextAssembler()
  finalBlockAssembler.push({ type: 'block-end', index: 0, block: { type: 'text', text: '{"action":"keep"}' } })
  finalBlockAssembler.push({ type: 'finish', reason: { kind: 'stop' } })
  assert.equal(finalBlockAssembler.finish().text, '{"action":"keep"}')
})

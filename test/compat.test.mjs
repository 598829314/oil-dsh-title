import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 回归：DSH 0.2.x 的插件管理器会按 peerDependencies 做安装期版本门禁，
// 精确锁定 0.1.2-rc.1 会让 0.2.x 用户在安装阶段直接被拒绝。
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function parse(version) {
  const [core, pre] = version.split('-')
  return { nums: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }
}

function compare(a, b) {
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] < right.nums[i] ? -1 : 1
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const l = left.pre[i]
    const r = right.pre[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    const ln = Number(l)
    const rn = Number(r)
    const lIsNum = !Number.isNaN(ln)
    const rIsNum = !Number.isNaN(rn)
    if (lIsNum && rIsNum) return ln < rn ? -1 : 1
    if (lIsNum !== rIsNum) return lIsNum ? -1 : 1
    return l < r ? -1 : 1
  }
  return 0
}

function satisfies(version, range) {
  return range.split(' ').filter(Boolean).every(part => {
    const matched = part.match(/^(>=|<=|>|<|=)?(.*)$/)
    const verdict = compare(version, matched[2])
    switch (matched[1] || '=') {
      case '>=': return verdict >= 0
      case '<=': return verdict <= 0
      case '>': return verdict > 0
      case '<': return verdict < 0
      default: return verdict === 0
    }
  })
}

test('peer 范围同时覆盖 0.1.2-rc.1 与 0.2.1-rc.2', () => {
  for (const dep of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-title']) {
    const range = pkg.peerDependencies[dep]
    assert.ok(range, `缺少 ${dep} 的 peer 声明`)
    assert.equal(satisfies('0.1.2-rc.1', range), true, `${dep} ${range} 不包含 0.1.2-rc.1`)
    assert.equal(satisfies('0.2.1-rc.2', range), true, `${dep} ${range} 不包含 0.2.1-rc.2`)
  }
})

test('没有锁死的精确 peer 版本', () => {
  for (const [dep, range] of Object.entries(pkg.peerDependencies)) {
    assert.match(range, /[<>=^~]/, `${dep} 仍然使用精确版本 ${range}`)
  }
})

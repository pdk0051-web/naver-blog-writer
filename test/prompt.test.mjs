import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt, normalizeInput, InputError, KINDS } from '../src/ai/prompt.mjs'
import { voiceHints } from '../src/ai/voice.mjs'

const base = { topic: '동네 빵집 소금빵', kind: 'food', tone: 'haeyo', length: 'normal', memo: '토요일 방문, 소금빵 3,500원', keywords: '소금빵' }

test('prompt contains topic, kind, tone, length, memo and JSON contract', () => {
  const p = buildPrompt(base)
  assert.match(p, /주제: 동네 빵집 소금빵/)
  assert.match(p, /글 종류: 맛집·카페/)
  assert.match(p, /해요체/)
  assert.match(p, /1,600~2,300자/)
  assert.match(p, /토요일 방문, 소금빵 3,500원/)
  for (const key of ['"title"', '"body_html"', '"tags"', '"photo_suggestions"']) assert.ok(p.includes(key), key)
})

test('voice rules are present', () => {
  const p = buildPrompt(base)
  assert.match(p, /\[내 메모\]에 적힌 것만/)
  assert.match(p, /숫자로 보는/)
  assert.match(p, /제공된 자료/)
  assert.match(p, /지어내지 않는다/)
})

test('empty memo forbids first-person experience', () => {
  const p = buildPrompt({ ...base, memo: '' })
  assert.match(p, /직접 경험·후기·방문담을 쓰지 말고/)
  assert.match(p, /\(비어 있음\)/)
})

test('합쇼체 switches the voice line', () => {
  const p = buildPrompt({ ...base, tone: 'hapsho' })
  assert.match(p, /합쇼체/)
  assert.doesNotMatch(p, /친근한 해요체\(~해요/)
})

test('every kind has a label and note in the prompt', () => {
  for (const kind of Object.keys(KINDS)) assert.match(buildPrompt({ ...base, kind }), new RegExp(KINDS[kind].label))
})

test('unknown options fall back to defaults; missing topic is refused', () => {
  const n = normalizeInput({ topic: ' t ', kind: 'evil', tone: 'x', length: 'huge' })
  assert.deepEqual([n.topic, n.kind, n.tone, n.length], ['t', 'info', 'haeyo', 'normal'])
  assert.throws(() => normalizeInput({ topic: '   ' }), InputError)
})

test('memo is length-capped', () => {
  assert.equal(normalizeInput({ topic: 't', memo: 'a'.repeat(10000) }).memo.length, 6000)
})

test('voice hints flag AI tells and stay quiet on clean text', () => {
  const tells = voiceHints('숫자로 보는 소금빵. 제공된 자료에 따르면 맛있다. 결론적으로 좋아요.', 'haeyo')
  assert.ok(tells.length >= 3)
  assert.deepEqual(voiceHints('주말 아침에 다녀왔어요. 줄이 조금 있었지만 금방 들어갔어요.', 'haeyo'), [])
})

test('mixed 다 endings in 해요체 are flagged', () => {
  const text = Array.from({ length: 8 }, (_, i) => `이것은 문장 번호 ${i} 이다.`).join(' ')
  assert.ok(voiceHints(text, 'haeyo').some((h) => /~다/.test(h)))
  assert.ok(!voiceHints(text, 'hapsho').some((h) => /~다/.test(h)))
})

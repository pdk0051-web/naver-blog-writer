import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJson, normalizeDraft, parseDraft, ParseError } from '../src/ai/parse.mjs'

const body = '<h2>소제목</h2><p>' + '본문 문장이 이어집니다. '.repeat(6) + '</p>'

test('parses plain JSON', () => {
  const d = parseDraft(JSON.stringify({ title: '제목', body_html: body, tags: ['#소금빵', '빵집'], photo_suggestions: ['외관'] }))
  assert.equal(d.title, '제목')
  assert.deepEqual(d.tags, ['소금빵', '빵집'])
  assert.deepEqual(d.photos, ['외관'])
  assert.match(d.html, /^<h2>소제목<\/h2>/)
})

test('strips code fences and surrounding chatter', () => {
  const raw = '다음은 결과입니다.\n```json\n' + JSON.stringify({ title: 't', body_html: body, tags: [] }) + '\n```\n끝'
  assert.equal(parseDraft(raw).title, 't')
})

test('repairs trailing commas and raw newlines inside strings', () => {
  const raw = '{"title": "줄바꿈\n제목", "body_html": "' + body.replace(/"/g, '\\"') + '", "tags": ["a", "b",],}'
  const obj = extractJson(raw)
  assert.equal(obj.title, '줄바꿈\n제목')
  assert.deepEqual(obj.tags, ['a', 'b'])
})

test('braces inside strings do not confuse extraction', () => {
  const obj = extractJson('{"title": "괄호 } 포함 {", "body_html": "x"}')
  assert.equal(obj.title, '괄호 } 포함 {')
})

test('accepts sections instead of body_html and object photo suggestions', () => {
  const d = normalizeDraft({
    title: '제목',
    sections: [{ heading: '하나', paragraphs: ['첫 문단입니다. '.repeat(5), '둘째 <b>문단</b>'] }, { heading: '둘', body: '셋째 문단입니다. '.repeat(3) }],
    hashtags: '태그1, 태그2',
    photo_suggestions: [{ position: '하나 아래', description: '외관 사진' }],
  })
  assert.match(d.html, /<h2>하나<\/h2><p>첫 문단/)
  assert.match(d.html, /<b>문단<\/b>/)
  assert.deepEqual(d.tags, ['태그1', '태그2'])
  assert.deepEqual(d.photos, ['하나 아래 — 외관 사진'])
})

test('sanitizes body and removes placeholders from title', () => {
  const d = normalizeDraft({ title: '⟦사진⟧ 제목 <b>굵게</b>', body_html: body + '<script>alert(1)</script><p>⟦사진 2⟧</p>' })
  assert.equal(d.title, '제목 굵게')
  assert.ok(!/script|⟦/.test(d.html))
})

test('truncated answer gives a Korean error', () => {
  assert.throws(() => extractJson('{"title": "끊긴", "body_html": "<p>'), (e) => e instanceof ParseError && /끊겼/.test(e.message))
})

test('missing title or too short body is rejected', () => {
  assert.throws(() => normalizeDraft({ title: '', body_html: body }), ParseError)
  assert.throws(() => normalizeDraft({ title: '제목', body_html: '<p>짧음</p>' }), ParseError)
})

test('no JSON at all is rejected', () => {
  assert.throws(() => extractJson('죄송하지만 쓸 수 없어요.'), ParseError)
})

test('tags are de-duplicated and capped at 10', () => {
  const tags = Array.from({ length: 15 }, (_, i) => `태그${i % 12}`)
  const d = normalizeDraft({ title: 't', body_html: body, tags })
  assert.equal(d.tags.length, 10)
  assert.equal(new Set(d.tags).size, 10)
})

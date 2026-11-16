import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeHtml, htmlToPlain, ALLOWED_TAGS } from '../src/ai/sanitize.mjs'

const tagsIn = (html) => [...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1])

test('keeps allowed tags and drops attributes', () => {
  const out = sanitizeHtml('<p class="x" onclick="evil()">안녕 <strong style="color:red">굵게</strong></p>')
  assert.equal(out, '<p>안녕 <strong>굵게</strong></p>')
})

test('removes script, style and iframe including their content', () => {
  const out = sanitizeHtml('<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="x">y</iframe><p>b</p>')
  assert.equal(out, '<p>a</p><p>b</p>')
  assert.ok(!/alert|iframe/.test(out))
})

test('unwraps links and drops images', () => {
  const out = sanitizeHtml('<p>여기 <a href="javascript:x">링크</a><img src=x onerror=alert(1)></p>')
  assert.equal(out, '<p>여기 링크</p>')
})

test('renames headings and em, closes unclosed tags', () => {
  const out = sanitizeHtml('<h1>제목</h1><h4>작게</h4><p><em>기울임<b>굵게')
  assert.equal(out, '<h2>제목</h2><h3>작게</h3><p><i>기울임<b>굵게</b></i></p>')
})

test('escapes stray angle brackets but keeps entities', () => {
  const out = sanitizeHtml('<p>1 < 2 &amp; 3 > 2 &copy; & 끝</p>')
  assert.equal(out, '<p>1 &lt; 2 &amp; 3 &gt; 2 &copy; &amp; 끝</p>')
})

test('lists stay lists; stray li becomes paragraph', () => {
  assert.equal(sanitizeHtml('<ul><li>하나<li>둘</ul>'), '<ul><li>하나</li><li>둘</li></ul>')
  assert.equal(sanitizeHtml('<li>혼자</li>'), '<p>혼자</p>')
})

test('photo placeholders never survive', () => {
  const out = sanitizeHtml('<p>앞 문단</p><p>⟦사진 1⟧</p><p>[사진: 매장 외관]</p><p>📸 메뉴판</p><p>뒤 문단</p>')
  assert.equal(out, '<p>앞 문단</p><p> 메뉴판</p><p>뒤 문단</p>')
  assert.ok(!/⟦|사진:|📸/.test(out))
})

test('only allowlisted tags remain on hostile input', () => {
  const hostile = '<div><section><svg><script>x</script></svg><table><tr><td>셀</td></tr></table><p>본문<br/>줄</p></section></div><form><input></form>'
  const out = sanitizeHtml(hostile)
  for (const t of tagsIn(out)) assert.ok(ALLOWED_TAGS.includes(t), `unexpected tag ${t}`)
  assert.match(out, /본문<br>줄/)
  assert.ok(tagsIn(out).length > 0, 'control: output should still contain tags')
})

test('htmlToPlain gives one line per block', () => {
  assert.equal(htmlToPlain('<h2>소제목</h2><p>첫 줄<br>둘째 &amp; 셋째</p><ul><li>a</li></ul>'), '소제목\n첫 줄\n둘째 & 셋째\n- a')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkClickTarget, createEditor, isPublishLike, keepClipboard, EditorStop, NAVER_PATTERNS } from '../src/naver/editor.mjs'

const target = (text, cls, extra = {}) => ({
  found: true, offscreen: false, point: [10, 10], hitInside: true,
  target: { text, cls, aria: '' }, hitButton: { text, cls, aria: '' }, ...extra,
})
const refusedAs = (kind) => (e) => e instanceof EditorStop && e.kind === kind

test('publish words are recognised', () => {
  for (const w of ['발행', '예약 발행', 'publish_btn__x', 'Reserve', '발행하기']) assert.ok(isPublishLike(w), w)
  for (const w of ['저장', '임시저장', 'save_btn__abc', '']) assert.ok(!isPublishLike(w), w)
})

test('control: «저장» is allowed', () => {
  assert.equal(checkClickTarget('save', target('저장', 'save_btn__a1')), true)
})

test('«발행» button is refused even when it sits where «저장» should be', () => {
  assert.throws(() => checkClickTarget('save', target('발행', 'save_btn__a1')), refusedAs('publish-refused'))
  assert.throws(() => checkClickTarget('save', target('저장', 'publish_btn__z')), refusedAs('publish-refused'))
})

test('a publish button covering the save point is refused', () => {
  const t = target('저장', 'save_btn__a1', { hitInside: false, hitButton: { text: '발행', cls: 'publish_btn__z', aria: '' } })
  assert.throws(() => checkClickTarget('save', t), refusedAs('publish-refused'))
})

test('a covered target is refused', () => {
  const t = target('저장', 'save_btn__a1', { hitInside: false, hitButton: null })
  assert.throws(() => checkClickTarget('save', t), refusedAs('covered'))
})

test('save role requires the exact text «저장»', () => {
  assert.throws(() => checkClickTarget('save', target('저장 목록', 'save_btn__a1')), refusedAs('not-save'))
})

test('unknown roles are refused', () => {
  assert.throws(() => checkClickTarget('publish', target('발행', 'x')), refusedAs('role'))
})

test('body text may contain 예약 (only names are checked for title/body)', () => {
  const t = { ...target('예약 방법 안내', 'se-text-paragraph'), hitButton: null }
  assert.equal(checkClickTarget('body', t), true)
})

test('Naver URL patterns', () => {
  assert.ok(NAVER_PATTERNS.top.test('https://blog.naver.com/someone?Redirect=Write&'))
  assert.ok(NAVER_PATTERNS.top.test('https://blog.naver.com/GoBlogWrite.naver'))
  assert.ok(!NAVER_PATTERNS.top.test('https://blog.naver.com/someone'))
  assert.ok(NAVER_PATTERNS.frame.test('https://blog.naver.com/PostWriteForm.naver?blogId=someone'))
  assert.ok(NAVER_PATTERNS.login.test('https://nid.naver.com/nidlogin.login?mode=form'))
})

// Fake webContents: the page reports a «발행» button where «저장» should be.
function fakeWebContents({ saveText, url = 'https://blog.naver.com/someone?Redirect=Write', toasts = () => [], draftCount = () => 0 }) {
  const events = []
  const frame = {
    url: 'https://blog.naver.com/PostWriteForm.naver?blogId=someone',
    executeJavaScript: async (code) => {
      if (code.includes('"op":"state"')) return { ready: true, title: '제목', bodyText: '본문', bodyLength: 100, images: 0, popup: null, toasts: toasts(events), draftCount: draftCount(events) }
      return target(saveText, 'save_btn__a1')
    },
  }
  const main = { url, framesInSubtree: [], executeJavaScript: async () => [0, 0] }
  main.framesInSubtree = [main, frame]
  return {
    events,
    getURL: () => url,
    mainFrame: main,
    getZoomFactor: () => 1,
    sendInputEvent: (e) => events.push(e),
  }
}

test('tempSave never sends a click when the button says «발행»', async () => {
  const wc = fakeWebContents({ saveText: '발행' })
  const editor = createEditor(wc, { clipboard: {}, pace: [0, 0] })
  await assert.rejects(editor.tempSave(), refusedAs('publish-refused'))
  assert.equal(wc.events.length, 0)
})

test('control: tempSave clicks once when the button says «저장»', async () => {
  const wc = fakeWebContents({ saveText: '저장' })
  const editor = createEditor(wc, { clipboard: {}, pace: [0, 0] })
  const r = await Promise.race([editor.tempSave().catch((e) => e), new Promise((res) => setTimeout(() => res('pending'), 400))])
  assert.ok(r === 'pending' || r?.confirmed === false || r instanceof Error)
  assert.deepEqual(wc.events.filter((e) => e.type === 'mouseDown').length, 1)
})

test('login page stops before anything is touched', async () => {
  const wc = fakeWebContents({ saveText: '저장', url: 'https://nid.naver.com/nidlogin.login' })
  const editor = createEditor(wc, { clipboard: {}, pace: [0, 0] })
  assert.equal(editor.where().page, 'login')
  await assert.rejects(editor.tempSave(), refusedAs('login'))
  assert.equal(wc.events.length, 0)
})

test('a toast that was already showing does not count as a new save', async () => {
  // No draft counter; the same non-save toast stays before and after the click.
  const wc = fakeWebContents({ saveText: '저장', toasts: () => ['사진을 올리는 중입니다'], draftCount: () => null })
  const editor = createEditor(wc, { clipboard: {}, pace: [0, 0], confirmMs: 300 })
  assert.deepEqual(await editor.tempSave(), { confirmed: false })
})

test('control: a «저장» toast that appears after the click confirms the save', async () => {
  const wc = fakeWebContents({ saveText: '저장', toasts: (ev) => (ev.length ? ['임시저장 완료'] : []), draftCount: () => null })
  const editor = createEditor(wc, { clipboard: {}, pace: [0, 0], confirmMs: 2000 })
  assert.equal((await editor.tempSave()).confirmed, true)
})

test('clipboard is left alone when it could not be read', async () => {
  let cleared = 0
  const restore = await keepClipboard({ read: async () => { throw new Error('denied') }, clear: () => { cleared++ } }, class {})
  await restore()
  assert.equal(cleared, 0)
})

test('control: an empty clipboard is restored as empty; content is written back', async () => {
  let cleared = 0
  const restoreEmpty = await keepClipboard({ read: async () => [], clear: () => { cleared++ } }, class {})
  await restoreEmpty()
  assert.equal(cleared, 1)
  const written = []
  class Item { constructor(e) { this.e = e } }
  const restoreFull = await keepClipboard({
    read: async () => [{ types: ['text/plain'], getType: async () => '원래 글' }],
    write: async (items) => { written.push(...items) }, clear: () => { cleared++ },
  }, Item)
  await restoreFull()
  assert.deepEqual(written.map((i) => i.e), [{ 'text/plain': '원래 글' }])
  assert.equal(cleared, 1)
})

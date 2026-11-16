// Electron smoke test. Starts the real app against a LOCAL mock of the Naver
// editor (no network, temporary profile), drives the panel like a user, and
// checks: title/body land, «저장» is clicked, «발행» is never clicked.
// Usage: npm run test:smoke   (add --screenshots to refresh docs/screenshots)
import { app, BrowserWindow, webContents, clipboard, ClipboardItem } from 'electron'
import { keepClipboard } from '../../src/naver/editor.mjs'
import http from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = import.meta.dirname
const SHOTS = process.argv.includes('--screenshots')
if (SHOTS) app.commandLine.appendSwitch('force-device-scale-factor', '2')

const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms, what) {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* keep waiting */ }
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await sleep(150)
  }
}

// Local mock server: /<id>?Redirect=Write is the outer page, the editor lives in an iframe.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (type, body) => { res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); res.end(body) }
  if (u.pathname === '/PostWriteForm.naver') return send('text/html', readFileSync(path.join(here, 'mock', 'frame.html')))
  if (u.pathname === '/frame.js') return send('text/javascript', readFileSync(path.join(here, 'mock', 'frame.js')))
  if (/^\/[A-Za-z0-9_-]+$/.test(u.pathname) && u.searchParams.get('Redirect') === 'Write') {
    const id = u.pathname.slice(1)
    const popup = u.searchParams.get('popup') === '1' ? '&popup=1' : ''
    return send('text/html', `<!doctype html><meta charset="utf-8"><title>mock write</title><style>body{margin:0}iframe{border:0;width:100%;height:100vh;display:block}</style><iframe id="mainFrame" src="/PostWriteForm.naver?blogId=${id}&Redirect=Write${popup}"></iframe>`)
  }
  res.writeHead(404); res.end('not found')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const userData = mkdtempSync(path.join(os.tmpdir(), 'nbw-smoke-'))

process.env.NBW_USER_DATA = userData
process.env.NBW_MOCK_ORIGIN = origin
process.env.NBW_START_URL = `${origin}/nbwtester?Redirect=Write`
process.env.NBW_FAKE_ANSWER = path.join(here, 'fixture-answer.txt')
await import('../../src/main.mjs')
// Electron waits for the entry module's top-level awaits before emitting
// 'ready', so the test body must not await readiness at the top level.
app.whenReady().then(run)

async function run() {
let exitCode = 1
// The test writes to the system clipboard; put the user's clipboard back afterwards.
const restoreUserClipboard = await keepClipboard(clipboard, ClipboardItem)
try {
  const panel = await until(() => webContents.getAllWebContents().find((w) => w.getURL().endsWith('/panel/index.html')), 15000, 'panel')
  const naver = await until(() => webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin)), 15000, 'naver view')
  const win = BrowserWindow.getAllWindows()[0]
  win.focus()
  const P = (code) => panel.executeJavaScript(code, true)
  const frame = () => naver.mainFrame.framesInSubtree.find((f) => f.url.includes('/PostWriteForm.naver'))
  const F = (code) => frame().executeJavaScript(code)
  const click = (id) => P(`document.getElementById(${JSON.stringify(id)}).click(); true`)
  const settle = () => until(() => P(`(() => { const m = document.getElementById('msg'); return m.className !== 'msg info' && m.textContent ? { cls: m.className, text: m.textContent } : null })()`), 60000, 'panel message')
  const editorReady = () => until(() => frame() && F(`!!document.querySelector('.se-title-text')`), 15000, 'mock editor')

  await until(() => P(`document.body.dataset.ready === '1'`), 15000, 'panel ready')
  check('panel loads under CSP', true)
  const isolated = await P(`typeof require === 'undefined' && typeof process === 'undefined' && typeof window.writer === 'object'`)
  check('panel has no Node access, only the bridge', isolated)
  await editorReady()

  // 1) Generate (fake engine answer contains a <script> and a ⟦사진 1⟧ marker).
  await P(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
    set('topic', '주말 아침 동네 빵집 소금빵 후기')
    set('memo', '토요일 오전 방문, 줄 10분, 소금빵 3,500원, 겉은 바삭하고 버터 향이 진함')
    set('keywords', '소금빵, 동네 빵집')
    document.querySelector('#kind [data-value="food"]').click()
    return true })()`)
  await click('btnGenerate')
  const gen = await settle()
  check('generate shows a preview', gen.cls === 'msg ok' && !(await P(`document.getElementById('preview').hidden`)), gen.text)
  const preview = await P(`({ title: document.getElementById('pTitle').value, html: document.getElementById('pBody').innerHTML,
    photos: document.querySelectorAll('#pPhotos li').length, tags: document.getElementById('pTags').textContent })`)
  check('preview is sanitized (no script, no photo marker)', !/<script|⟦|alert/.test(preview.html) && /<h2>/.test(preview.html), preview.html.slice(0, 60))
  check('photo suggestions shown in preview only', preview.photos === 3)
  check('tags shown without duplicates of #', /#소금빵/.test(preview.tags) && !/##/.test(preview.tags))

  if (SHOTS) {
    await P(`document.querySelector('main').scrollTop = document.getElementById('preview').offsetTop - 260; true`)
    await sleep(400)
    writeFileSync(path.join(here, '..', '..', 'docs', 'screenshots', 'panel-write.png'), (await panel.capturePage()).toPNG())
    await P(`document.querySelector('main').scrollTop = 0; true`)
  }

  // 2) Insert into the mock editor; the user's clipboard must come back unchanged.
  const sentinel = '원래 클립보드 내용 SENTINEL'
  await clipboard.writeText(sentinel)
  await click('btnInsert')
  const ins = await settle()
  check('insert reports success', ins.cls === 'msg ok', ins.text)
  const after = await F(`({ title: document.querySelector('.se-documentTitle .se-text-paragraph').innerText.trim(),
    body: [...document.querySelectorAll('.se-component.se-text')].map((c) => c.innerText).join('\\n'),
    pasted: window.__pastedHtml || '', log: window.__log.slice(), published: window.__published })`)
  check('title landed in the editor', after.title === preview.title, after.title)
  check('body landed in the editor', after.body.includes('겉면은 바삭하게') && after.body.includes('다시 갈 생각이에요'), `${after.body.length} chars`)
  check('pasted HTML is allowlisted and has no placeholders', !/⟦|<script|style=|class=/.test(after.pasted) && /<h2>/.test(after.pasted))
  check('no button was clicked while inserting', after.log.length === 0, JSON.stringify(after.log))
  check('clipboard restored after paste', (await clipboard.readText()) === sentinel)

  // 3) Temporary save.
  await click('btnSave')
  const sv = await settle()
  const afterSave = await F(`({ log: window.__log.slice(), published: window.__published, aria: document.querySelector('[class^="save_count_btn"]').getAttribute('aria-label') })`)
  check('«저장» clicked and confirmed', sv.cls === 'msg ok' && afterSave.log.join() === '저장' && /1개/.test(afterSave.aria), `${sv.text} | ${afterSave.log}`)
  check('«발행» never clicked', afterSave.published === false && !afterSave.log.includes('발행'))

  // 4) Control: the save button now reads «발행» → must be refused, no click.
  await sleep(2700) // let the previous toast disappear
  await F(`document.querySelector('[class^="save_btn__"]').textContent = '발행'; true`)
  await click('btnSave')
  const c1 = await settle()
  const log1 = await F(`({ log: window.__log.slice(), published: window.__published })`)
  check('control: «발행»-labelled save button refused', c1.cls === 'msg error' && /발행/.test(c1.text) && log1.log.length === 1 && !log1.published, c1.text)
  await F(`document.querySelector('[class^="save_btn__"]').textContent = '저장'; true`)

  // 5) Control: a «발행» button laid over «저장» → refused, no click.
  await F(`(() => { const s = document.querySelector('[class^="save_btn__"]').getBoundingClientRect()
    const b = document.createElement('button'); b.id = 'cover'; b.className = 'publish_btn__cover'; b.textContent = '발행'
    Object.assign(b.style, { position: 'fixed', left: s.x - 4 + 'px', top: s.y - 4 + 'px', width: s.width + 8 + 'px', height: s.height + 8 + 'px', zIndex: 9 })
    document.body.append(b); return true })()`)
  await click('btnSave')
  const c2 = await settle()
  const log2 = await F(`({ log: window.__log.slice(), published: window.__published })`)
  check('control: «발행» covering «저장» refused', c2.cls === 'msg error' && log2.log.length === 1 && !log2.published, c2.text)
  await F(`document.getElementById('cover').remove(); true`)

  // 6) Control: inserting again into a non-empty editor is refused.
  await click('btnInsert')
  const c3 = await settle()
  check('control: non-empty editor is not overwritten', c3.cls === 'msg error' && /이미/.test(c3.text), c3.text)

  // 7) Control: a «작성 중인 글» popup stops the run without touching it.
  await naver.loadURL(`${origin}/nbwtester?Redirect=Write&popup=1`)
  await editorReady()
  await click('btnInsert')
  const c4 = await settle()
  const pop = await F(`({ log: window.__log.slice(), title: document.querySelector('.se-documentTitle .se-text-paragraph').innerText.trim(), popup: !!document.querySelector('.se-popup') })`)
  check('control: restore popup stops insertion', c4.cls === 'msg error' && /안내창/.test(c4.text) && pop.log.length === 0 && !pop.title && pop.popup, c4.text)

  // 8) Blog id detected from the write-page URL.
  const chip = await P(`document.getElementById('naverChip').textContent`)
  check('blog id detected', /nbwtester/.test(chip), chip)

  if (SHOTS) {
    await P(`document.querySelector('[data-tab="ai"]').click(); true`)
    await sleep(400)
    writeFileSync(path.join(here, '..', '..', 'docs', 'screenshots', 'panel-ai.png'), (await panel.capturePage()).toPNG())
  }

  exitCode = results.every((r) => r.pass) ? 0 : 1
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} smoke checks passed`)
} catch (e) {
  console.log(`FAIL smoke crashed — ${e.stack}`)
} finally {
  await restoreUserClipboard().catch((e) => console.log(`WARN clipboard not restored — ${e.message}`))
  server.close()
  rmSync(userData, { recursive: true, force: true })
  app.exit(exitCode)
}
}

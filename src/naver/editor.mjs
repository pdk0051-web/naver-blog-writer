// Puts a draft into Naver SmartEditor ONE and presses «저장» (temporary save).
//
// Safety rules:
// - Never publishes. Right before every click the element that will actually
//   receive the click is read again; anything named like publish/발행/예약 is refused.
// - Only three roles can be clicked: the title, the body, and the «저장» button.
// - Stops on Naver login/security pages; the user signs in herself.
// - Never discards an existing draft: a restore popup or a non-empty editor stops the run.
// - The user's clipboard is saved before pasting and restored afterwards.
// Page-side code only reads the DOM; all input goes through sendInputEvent/insertText/paste.

export class EditorStop extends Error {
  constructor(message, kind = 'stop') { super(message); this.name = 'EditorStop'; this.kind = kind }
}

export const PUBLISH_WORDS = /발행|publish|예약|reserve|schedule/i
export const ROLES = Object.freeze(['title', 'body', 'save'])

export const NAVER_PATTERNS = Object.freeze({
  top: /^https:\/\/blog\.naver\.com\/(GoBlogWrite\.naver$|[A-Za-z0-9_-]{2,40}\?Redirect=Write(&|$))/,
  frame: /^https:\/\/blog\.naver\.com\/PostWriteForm\.naver\?/,
  login: /^https:\/\/nid\.naver\.(com|net)\//,
})

export const isPublishLike = (text) => PUBLISH_WORDS.test(String(text ?? ''))

/**
 * Decides whether a click on `role` is allowed, given what the page reports at
 * the click point. Pure function so it can be unit-tested. Throws EditorStop.
 */
export function checkClickTarget(role, t) {
  if (!ROLES.includes(role)) throw new EditorStop(`정해진 자리 말고는 누르지 않아요: ${role}`, 'role')
  if (!t?.found) throw new EditorStop(`편집기에서 누를 자리를 찾지 못했어요(${role}).`, 'not-found')
  if (t.offscreen) throw new EditorStop('편집기 맨 위가 화면에 보이도록 올린 뒤 다시 눌러 주세요.', 'offscreen')
  const own = role === 'save' ? `${t.target?.text} ${t.target?.cls} ${t.target?.aria}` : `${t.target?.cls} ${t.target?.aria}`
  const hitButton = t.hitButton ? `${t.hitButton.text} ${t.hitButton.cls} ${t.hitButton.aria}` : ''
  if (isPublishLike(own) || isPublishLike(hitButton)) throw new EditorStop('발행 관련 버튼은 누르지 않아요. 발행은 직접 해 주세요.', 'publish-refused')
  if (!t.hitInside) throw new EditorStop('누를 자리를 다른 창이 덮고 있어 멈췄어요. 왼쪽 화면의 안내창을 닫고 다시 시도해 주세요.', 'covered')
  if (role === 'save' && String(t.target?.text ?? '').trim() !== '저장') throw new EditorStop('«저장» 버튼이 아니어서 누르지 않았어요.', 'not-save')
  return true
}

// Runs inside the editor frame. Reads only; must not reference outer variables.
function probe(q) {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const txt = (el) => String((el && (el.innerText ?? el.textContent)) || '').replace(/\s+/g, ' ').trim()
  const named = (el) => (el ? { text: txt(el).slice(0, 80), cls: String(el.className || '').slice(0, 200), aria: String(el.getAttribute?.('aria-label') || '') } : null)
  const withoutPlaceholders = (el) => {
    if (!el) return ''
    let t = String(el.innerText ?? el.textContent ?? '')
    // Hidden placeholders are already absent from innerText; only strip visible ones.
    for (const ph of el.querySelectorAll('.se-placeholder')) if (vis(ph)) t = t.replace(String(ph.innerText ?? ''), '')
    return t.replace(/[​﻿]/g, '').replace(/\s+/g, ' ').trim()
  }
  const titleEl = document.querySelector('.se-documentTitle .se-title-text')
  const wrap = document.querySelector('.se-components-wrap')
  const bodyBlocks = wrap ? [...wrap.querySelectorAll('.se-component')].filter((c) => !c.closest('.se-documentTitle')) : []
  const popupEl = [...document.querySelectorAll('.se-popup')].find(vis) || null
  if (q.op === 'state') {
    const countEl = document.querySelector('button[class^="save_count_btn"]')
    const counted = countEl ? /(\d+)\s*개/.exec(countEl.getAttribute('aria-label') || '') : null
    const toasts = [...document.querySelectorAll('[class*="toast"]')].filter(vis).map((t) => txt(t).slice(0, 80)).filter(Boolean)
    const body = bodyBlocks.map(withoutPlaceholders).join('\n').trim()
    return {
      ready: Boolean(titleEl && wrap),
      title: withoutPlaceholders(titleEl),
      bodyText: body.slice(0, 200),
      bodyLength: body.length,
      images: wrap ? wrap.querySelectorAll('.se-component.se-image').length : 0,
      popup: popupEl ? { title: txt(popupEl.querySelector('.se-popup-title')).slice(0, 80), text: txt(popupEl).slice(0, 200) } : null,
      toasts,
      draftCount: counted ? Number(counted[1]) : null,
    }
  }
  let el = null
  let atStart = false
  if (q.role === 'title') { el = titleEl; atStart = true }
  if (q.role === 'body' && wrap) {
    const paragraphs = [...wrap.querySelectorAll('.se-component.se-text .se-text-paragraph')].filter((p) => !p.closest('.se-documentTitle') && vis(p))
    el = paragraphs[0] || null
    atStart = true
  }
  if (q.role === 'save') el = document.querySelector('button[class^="save_btn__"]')
  if (!el || !vis(el)) return { found: false }
  const r = el.getBoundingClientRect()
  const x = atStart ? r.x + Math.min(6, r.width / 2) : r.x + r.width / 2
  const y = r.y + r.height / 2
  if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) return { found: true, offscreen: true }
  const hit = document.elementFromPoint(x, y)
  return {
    found: true, offscreen: false, point: [Math.round(x), Math.round(y)],
    target: named(el), hit: named(hit), hitButton: named(hit ? hit.closest('button, a, [role="button"]') : null),
    hitInside: Boolean(hit && (el === hit || el.contains(hit))),
  }
}

const FRAME_OFFSET = `(() => { const f = document.getElementById('mainFrame'); if (!f) return null; const r = f.getBoundingClientRect(); return [r.x, r.y] })()`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const withTimeout = (promise, ms, what) => Promise.race([
  Promise.resolve(promise),
  new Promise((_, reject) => setTimeout(() => reject(new EditorStop(`${what}이(가) ${Math.round(ms / 1000)}초 안에 끝나지 않았어요.`, 'timeout')), ms)),
])

/**
 * Saves every clipboard entry and returns an async function that puts it back.
 * The clipboard is cleared on restore only if it was positively read as empty;
 * if it could not be read, it is left alone. Uses the Electron 44 async API.
 */
export async function keepClipboard(clipboard, ClipboardItem) {
  let items
  try { items = await withTimeout(clipboard.read(), 3000, '클립보드 읽기') } catch { items = null }
  const kept = []
  for (const item of items ?? []) {
    const entry = {}
    for (const type of item.types ?? []) {
      try { entry[type] = await item.getType(type) } catch { /* format not readable */ }
    }
    if (Object.keys(entry).length) kept.push(entry)
  }
  const wasEmpty = Array.isArray(items) && items.length === 0
  return async () => {
    if (kept.length) await withTimeout(clipboard.write(kept.map((e) => new ClipboardItem(e))), 3000, '클립보드 되돌리기')
    else if (wasEmpty) clipboard.clear()
  }
}

/**
 * @param wc webContents of the Naver view
 * @param opts { clipboard, ClipboardItem, patterns, log, pace: [min,max] ms between steps, confirmMs }
 */
export function createEditor(wc, opts = {}) {
  const { clipboard, ClipboardItem } = opts
  const patterns = opts.patterns ?? NAVER_PATTERNS
  const log = opts.log ?? (() => {})
  const [lo, hi] = opts.pace ?? [250, 600]
  const pause = () => sleep(lo + Math.random() * Math.max(0, hi - lo))
  const confirmMs = opts.confirmMs ?? 15_000

  function where() {
    const top = String(wc.getURL())
    const frames = wc.mainFrame.framesInSubtree
    if (patterns.login.test(top) || frames.some((f) => patterns.login.test(String(f.url)))) return { page: 'login', top }
    if (!patterns.top.test(top) && !patterns.frame.test(top)) return { page: 'other', top }
    const frame = frames.find((f) => f !== wc.mainFrame && patterns.frame.test(String(f.url)))
      ?? (patterns.frame.test(top) ? wc.mainFrame : null)
    return frame ? { page: 'editor', top, frame } : { page: 'loading', top }
  }

  function here() {
    const w = where()
    if (w.page === 'login') throw new EditorStop('네이버 로그인이 필요해요. 왼쪽 화면에서 직접 로그인해 주세요.', 'login')
    if (w.page !== 'editor') throw new EditorStop('왼쪽 화면이 글쓰기 화면이 아니에요.', 'not-editor')
    return w.frame
  }

  const read = (q) => withTimeout(here().executeJavaScript(`(${probe.toString()})(${JSON.stringify(q)})`), 5000, '편집기 읽기')

  async function waitFor(check, ms, what) {
    const until = Date.now() + ms
    for (;;) {
      const got = await check()
      if (got) return got
      if (Date.now() > until) throw new EditorStop(`${what} — ${Math.round(ms / 1000)}초를 기다려도 안 됐어요.`, 'timeout')
      await sleep(300)
    }
  }

  async function frameOffset(frame) {
    if (frame === wc.mainFrame) return [0, 0]
    const offset = await withTimeout(wc.mainFrame.executeJavaScript(FRAME_OFFSET), 5000, '편집기 위치 읽기')
    if (!offset) throw new EditorStop('편집기 위치를 읽지 못했어요.', 'not-found')
    return offset
  }

  async function press(role) {
    if (!ROLES.includes(role)) throw new EditorStop(`정해진 자리 말고는 누르지 않아요: ${role}`, 'role')
    await pause()
    const frame = here()
    const [ox, oy] = await frameOffset(frame)
    const zoom = wc.getZoomFactor()
    // Read the click point last, then click without waiting in between.
    const t = await read({ op: 'target', role })
    checkClickTarget(role, t)
    const x = Math.round((ox + t.point[0]) * zoom)
    const y = Math.round((oy + t.point[1]) * zoom)
    here()
    log(`click ${role}`)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await pause()
  }

  const api = {
    where: () => { const { page, top } = where(); return { page, url: top } },

    state: () => read({ op: 'state' }),

    /** Loads a write page and waits until the editor (or a popup) shows. */
    async open(url) {
      if (where().page === 'login') here()
      await withTimeout(wc.loadURL(url), 30_000, '글쓰기 화면 열기').catch((e) => {
        // A redirect to the login page aborts the original load; report that instead.
        if (where().page === 'login') here()
        throw e
      })
      return waitFor(async () => {
        const w = where()
        if (w.page === 'login') here()
        if (w.page !== 'editor') return false
        try { const s = await read({ op: 'state' }); return s.ready || s.popup ? s : false } catch { return false }
      }, 30_000, '편집기 뜨기')
    },

    /** Types the title and pastes the body into an empty editor. */
    async insert({ title, html, plain }) {
      here()
      // The "continue writing?" popup often appears a moment after load.
      await sleep(1500)
      const before = await read({ op: 'state' })
      if (!before.ready) throw new EditorStop('편집기가 아직 준비되지 않았어요. 잠시 뒤 다시 눌러 주세요.', 'not-ready')
      if (before.popup) throw new EditorStop('네이버가 안내창을 띄웠어요(예: 작성 중인 글). 왼쪽 화면에서 직접 고른 뒤 다시 눌러 주세요.', 'popup')
      if (before.title || before.bodyLength > 0 || before.images > 0) {
        throw new EditorStop('편집기에 이미 쓰던 내용이 있어요. 덮어쓰지 않도록 멈췄어요. 새 글쓰기 화면에서 다시 눌러 주세요.', 'not-empty')
      }
      const restore = await keepClipboard(clipboard, ClipboardItem)
      try {
        await press('title')
        await withTimeout(wc.insertText(String(title)), 5000, '제목 넣기')
        await pause()
        const titled = await read({ op: 'state' })
        if (titled.title.replace(/\s+/g, '') !== String(title).replace(/\s+/g, '')) throw new EditorStop('제목이 제대로 들어가지 않았어요. 왼쪽 화면을 확인해 주세요.', 'title-mismatch')
        await press('body')
        await withTimeout(clipboard.write([new ClipboardItem({ 'text/html': String(html), 'text/plain': String(plain ?? '') })]), 3000, '클립보드 쓰기')
        here()
        log('paste body')
        wc.paste()
        const after = await waitFor(async () => { const s = await read({ op: 'state' }); return s.bodyLength > 20 ? s : false }, 15_000, '본문 붙여넣기')
        return after
      } finally {
        await restore().catch(() => {})
      }
    },

    /** Presses «저장» (temporary save) and waits for Naver to confirm. */
    async tempSave() {
      here()
      let before = await read({ op: 'state' })
      if (before.popup) throw new EditorStop('네이버 안내창이 떠 있어요. 왼쪽 화면에서 먼저 닫아 주세요.', 'popup')
      if (!before.title && before.bodyLength === 0) throw new EditorStop('편집기가 비어 있어 저장하지 않았어요.', 'empty')
      // An old «저장» toast would look like a fresh confirmation; let it go away first.
      if (before.toasts.some((t) => /저장/.test(t))) {
        before = await waitFor(async () => { const s = await read({ op: 'state' }); return s.toasts.some((t) => /저장/.test(t)) ? false : s }, 15_000, '이전 저장 안내 사라짐')
      }
      const oldToasts = new Set(before.toasts)
      await press('save')
      try {
        const after = await waitFor(async () => {
          const s = await read({ op: 'state' })
          if (Number.isInteger(before.draftCount) && Number.isInteger(s.draftCount) && s.draftCount > before.draftCount) return s
          return s.toasts.some((t) => !oldToasts.has(t) && /저장/.test(t)) ? s : false
        }, confirmMs, '임시저장 확인')
        return { confirmed: true, draftCount: after.draftCount }
      } catch (e) {
        if (e.kind === 'timeout') return { confirmed: false }
        throw e
      }
    },
  }
  return Object.freeze(api)
}

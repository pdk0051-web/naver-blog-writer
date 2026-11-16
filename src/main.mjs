// Main process: one window, Naver on the left, the writing panel on the right.
import { app, BrowserWindow, WebContentsView, ipcMain, clipboard, ClipboardItem, shell } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { KINDS, TONES, LENGTHS, buildPrompt, normalizeInput } from './ai/prompt.mjs'
import { parseDraft } from './ai/parse.mjs'
import { sanitizeHtml, htmlToPlain } from './ai/sanitize.mjs'
import { voiceHints } from './ai/voice.mjs'
import { ENGINES, DEFAULT_MODELS, detectClis, generate } from './ai/engines.mjs'
import { createNaverView } from './naver/view.mjs'
import { createEditor, NAVER_PATTERNS } from './naver/editor.mjs'
import { NAVER, writeUrlFor } from './naver/urls.mjs'
import * as settings from './settings.mjs'

// Development-only switches used by the smoke test; ignored in packaged builds.
const devEnv = (name) => (app.isPackaged ? undefined : process.env[name])
if (devEnv('NBW_USER_DATA')) app.setPath('userData', devEnv('NBW_USER_DATA'))
const MOCK_ORIGIN = devEnv('NBW_MOCK_ORIGIN') ?? null
const FAKE_ANSWER = devEnv('NBW_FAKE_ANSWER') ?? null
const START_URL = devEnv('NBW_START_URL') ?? NAVER.myBlog

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BASE = MOCK_ORIGIN ?? NAVER.base
const PATTERNS = MOCK_ORIGIN
  ? {
      top: new RegExp(`^${escapeRe(MOCK_ORIGIN)}/[A-Za-z0-9_-]{2,40}\\?Redirect=Write(&|$)`),
      frame: new RegExp(`^${escapeRe(MOCK_ORIGIN)}/PostWriteForm\\.naver\\?`),
      login: NAVER_PATTERNS.login,
    }
  : NAVER_PATTERNS

const PANEL_WIDTH = 460
const LINKS = Object.freeze({
  geminiKey: 'https://aistudio.google.com/apikey',
  anthropicKey: 'https://console.anthropic.com/settings/keys',
  openaiKey: 'https://platform.openai.com/api-keys',
  claudeCode: 'https://docs.claude.com/en/docs/claude-code/setup',
  codex: 'https://github.com/openai/codex',
})

let win = null
let panel = null
let naver = null
let editor = null
let naverStatus = { login: null, page: 'other' }
let clis = {}
let generating = null
let editorBusy = false

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

// No <webview> tags anywhere.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

function layout() {
  if (!win) return
  const { width, height } = win.getContentBounds()
  const panelW = Math.min(PANEL_WIDTH, Math.max(360, Math.round(width * 0.4)))
  naver?.view.setBounds({ x: 0, y: 0, width: Math.max(0, width - panelW), height })
  panel?.setBounds({ x: width - panelW, y: 0, width: panelW, height })
}

function sendStatus() {
  panel?.webContents.send('naver:status', { ...naverStatus, blogId: settings.getBlogId() })
}

const ok = (extra = {}) => ({ ok: true, ...extra })
const fail = (error) => ({ ok: false, error: String(error?.message ?? error) })

/** Registers an IPC handler that only answers our own panel. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!panel || event.sender !== panel.webContents) return fail('허용되지 않은 요청이에요.')
    try { return await fn(payload ?? {}) } catch (e) { return fail(e) }
  })
}

// Paths shown in the panel hide the user's home folder (screenshots get shared).
const displayClis = () => Object.fromEntries(Object.entries(clis).map(([id, c]) => [id, {
  found: c.found, path: c.path ? c.path.replace(os.homedir(), '~') : null,
}]))

function registerIpc() {
  handle('app:init', () => {
    clis = detectClis()
    return ok({
      version: app.getVersion(),
      platform: process.platform,
      kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])),
      tones: Object.fromEntries(Object.entries(TONES).map(([k, v]) => [k, v.label])),
      lengths: Object.fromEntries(Object.entries(LENGTHS).map(([k, v]) => [k, v.label])),
      engines: Object.entries(ENGINES).map(([id, e]) => ({ id, label: e.label, kind: e.kind })),
      defaultModels: DEFAULT_MODELS,
      settings: settings.publicSettings(),
      clis: displayClis(),
      naver: { ...naverStatus, blogId: settings.getBlogId() },
    })
  })

  handle('engines:detect', () => { clis = detectClis(); return ok({ clis: displayClis() }) })

  handle('settings:save', ({ engine, models }) => {
    settings.updateSettings({ engine, models })
    return ok({ settings: settings.publicSettings() })
  })

  handle('key:set', ({ provider, key }) => { settings.setKey(provider, key); return ok({ settings: settings.publicSettings() }) })
  handle('key:clear', ({ provider }) => { settings.clearKey(provider); return ok({ settings: settings.publicSettings() }) })

  handle('draft:generate', async (raw) => {
    if (generating) return fail('이미 글을 만들고 있어요.')
    const input = normalizeInput(raw)
    const prompt = buildPrompt(input)
    const engine = settings.getEngine()
    if (!engine && !FAKE_ANSWER) return fail("먼저 'AI 연결' 탭에서 쓸 AI를 골라 주세요.")
    if (!FAKE_ANSWER && ENGINES[engine].kind === 'api' && settings.keyStatus(engine) === 'broken') {
      return fail("저장된 키를 읽을 수 없어요. 'AI 연결' 탭에서 키를 다시 넣어 주세요.")
    }
    generating = new AbortController()
    try {
      const text = FAKE_ANSWER
        ? readFileSync(FAKE_ANSWER, 'utf8')
        : await generate({
            engine, prompt, signal: generating.signal,
            apiKey: ENGINES[engine].kind === 'api' ? settings.getKey(engine) : undefined,
            model: ENGINES[engine].kind === 'api' ? settings.getModel(engine) : undefined,
            cliPath: clis[engine]?.path ?? undefined,
          })
      const draft = parseDraft(text)
      return ok({ draft: { ...draft, hints: voiceHints(draft.plain, input.tone) } })
    } finally {
      generating = null
    }
  })

  handle('draft:cancel', () => { generating?.abort(); return ok() })

  handle('editor:insert', async ({ title, html }) => {
    const cleanTitle = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const cleanHtml = sanitizeHtml(String(html ?? '').slice(0, 300_000))
    const plain = htmlToPlain(cleanHtml)
    if (!cleanTitle) return fail('제목이 비어 있어요.')
    if (plain.length < 20) return fail('본문이 너무 짧아요.')
    if (editorBusy) return fail('편집기 작업이 아직 진행 중이에요.')
    editorBusy = true
    try {
      if (editor.where().page !== 'editor') await editor.open(writeUrlFor(settings.getBlogId(), BASE))
      await editor.insert({ title: cleanTitle, html: cleanHtml, plain })
      return ok({ message: '편집기에 넣었어요. 왼쪽에서 사진을 넣고 내용을 확인한 뒤 «임시저장»을 눌러 주세요.' })
    } finally {
      editorBusy = false
    }
  })

  handle('editor:save', async () => {
    if (editorBusy) return fail('편집기 작업이 아직 진행 중이에요.')
    editorBusy = true
    try {
      const r = await editor.tempSave()
      return ok({ message: r.confirmed
        ? '임시저장했어요. 발행은 왼쪽 네이버 화면에서 직접 해 주세요.'
        : '«저장»을 눌렀지만 확인 표시를 못 봤어요. 왼쪽 화면에서 저장됐는지 확인해 주세요.' })
    } finally {
      editorBusy = false
    }
  })

  handle('naver:go', ({ where }) => {
    const url = { write: writeUrlFor(settings.getBlogId(), BASE), myBlog: NAVER.myBlog, home: NAVER.home }[where]
    if (!url) return fail('알 수 없는 이동이에요.')
    naver.load(url)
    return ok()
  })
  handle('naver:back', () => { naver.back(); return ok() })
  handle('naver:reload', () => { naver.reload(); return ok() })
  handle('naver:logout', async () => {
    await naver.logout()
    settings.setBlogId(null)
    naverStatus = { login: null, page: 'other' }
    sendStatus()
    return ok()
  })

  handle('copy:text', async ({ text }) => {
    await clipboard.writeText(String(text ?? '').slice(0, 5000))
    return ok()
  })

  handle('link:open', ({ id }) => {
    if (!Object.hasOwn(LINKS, id)) return fail('열 수 없는 주소예요.')
    shell.openExternal(LINKS[id])
    return ok()
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 640,
    title: '네이버 블로그 글쓰기 도우미',
    backgroundColor: '#f4f5f7',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  naver = createNaverView(win, {
    base: BASE,
    startUrl: START_URL,
    extraOrigin: MOCK_ORIGIN,
    onStatus: ({ login, blogId, url }) => {
      if (blogId) settings.setBlogId(blogId)
      naverStatus = { login: login ? true : blogId ? false : naverStatus.login, page: PATTERNS.top.test(url) ? 'editor' : 'other' }
      sendStatus()
    },
  })
  editor = createEditor(naver.wc, { clipboard, ClipboardItem, patterns: PATTERNS })

  panel = new WebContentsView({
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  panel.setBackgroundColor('#f4f5f7')
  panel.webContents.on('will-navigate', (e) => e.preventDefault())
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.contentView.addChildView(panel)
  panel.webContents.loadFile(path.join(import.meta.dirname, 'panel', 'index.html'))

  layout()
  win.on('resize', layout)
  win.on('closed', () => { win = null; panel = null; naver = null })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => app.quit())

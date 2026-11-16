// Left pane: the real Naver blog in its own persistent session. The user signs
// in herself; the app only navigates, watches URLs, and hands the webContents to
// the editor automation. No preload, no injected scripts, no debugging port.
import { WebContentsView, session, shell, dialog } from 'electron'
import { NAVER, isNaverHost, isLoginUrl, blogIdFromUrl } from './urls.mjs'

export const NAVER_PARTITION = 'persist:naver'
// No clipboard-read: the app pastes with webContents.paste(), which needs no page permission.
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

function chromeLikeUserAgent() {
  const major = String(process.versions.chrome ?? '').split('.')[0] || '140'
  const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/**
 * @param win BrowserWindow
 * @param opts { startUrl, base, extraOrigin (dev only), onStatus({ login, blogId, url }) }
 */
export function createNaverView(win, opts = {}) {
  const base = opts.base ?? NAVER.base
  const allowed = (url) => isNaverHost(url) || Boolean(opts.extraOrigin && String(url).startsWith(opts.extraOrigin))
  const ses = session.fromPartition(NAVER_PARTITION)
  ses.setUserAgent(chromeLikeUserAgent())
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(PERMISSIONS.has(permission) && allowed(details?.requestingUrl)))
  ses.setPermissionCheckHandler((_wc, permission, origin) => PERMISSIONS.has(permission) && allowed(`${origin}/`))

  const view = new WebContentsView({
    webPreferences: { partition: NAVER_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  view.setBackgroundColor('#ffffff')
  const wc = view.webContents

  const stayInside = (event) => {
    const url = String(event.url ?? '')
    if (allowed(url)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
  }
  // Same limits for the main view and every Naver popup it opens (recursively).
  const confine = (contents) => {
    contents.on('will-navigate', stayInside)
    contents.on('will-redirect', stayInside)
    contents.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 980, height: 760, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } }
      }
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
    contents.on('did-create-window', (child) => confine(child.webContents))
  }
  confine(wc)

  // The editor blocks leaving with unsaved text; Electron needs us to ask.
  wc.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['머무르기', '떠나기'], defaultId: 0, cancelId: 0,
      message: '네이버 편집기에 저장하지 않은 글이 있을 수 있어요.',
      detail: '떠나면 쓰던 내용이 사라질 수 있어요. 먼저 «저장»을 눌러 두면 안전해요.',
    })
    if (choice === 1) event.preventDefault()
  })

  // Blog id detection: trust plain blog URLs only right after opening MyBlog.naver.
  let viaMyBlog = false
  let last = { login: null, blogId: null, url: '' }
  const report = (url) => {
    const login = isLoginUrl(url)
    const blogId = blogIdFromUrl(url, { fromMyBlog: viaMyBlog, base })
    if (!login && !/MyBlog\.naver/i.test(url)) viaMyBlog = false
    const next = { login, blogId: blogId ?? null, url }
    if (next.login !== last.login || next.blogId !== last.blogId || next.url !== last.url) {
      last = next
      opts.onStatus?.(next)
    }
  }
  wc.on('did-navigate', (_e, url) => report(url))
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) report(url) })
  wc.on('did-frame-navigate', (_e, url, _code, _status, isMainFrame) => {
    if (isMainFrame) return
    const blogId = blogIdFromUrl(url, { base })
    if (blogId && blogId !== last.blogId) { last = { ...last, login: false, blogId }; opts.onStatus?.(last) }
  })

  const load = (url) => {
    if (/MyBlog\.naver/i.test(url)) viaMyBlog = true
    return wc.loadURL(url).catch(() => {})
  }

  win.contentView.addChildView(view)
  load(opts.startUrl ?? NAVER.myBlog)

  return {
    view,
    wc,
    load,
    back: () => { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack() },
    reload: () => wc.reload(),
    /** Signs out of Naver inside this app only (clears this app's Naver session). */
    async logout() {
      await ses.clearStorageData()
      await ses.clearCache()
      viaMyBlog = false
      last = { login: null, blogId: null, url: '' }
      load(NAVER.myBlog)
    },
  }
}

// Naver URL helpers: login pages, write pages and blog id detection.

export const NAVER = Object.freeze({
  base: 'https://blog.naver.com',
  myBlog: 'https://blog.naver.com/MyBlog.naver',
  write: 'https://blog.naver.com/GoBlogWrite.naver',
  home: 'https://section.blog.naver.com/BlogHome.naver',
})

const BLOG_ID = /^[A-Za-z0-9_-]{2,40}$/

const parse = (raw) => { try { return new URL(String(raw)) } catch { return null } }

export function isNaverHost(raw) {
  const u = parse(raw)
  return Boolean(u && u.protocol === 'https:' && (u.hostname === 'naver.com' || u.hostname.endsWith('.naver.com')))
}

/** Naver login / security check pages. The app never automates these. */
export function isLoginUrl(raw) {
  const u = parse(raw)
  return Boolean(u && /^nid\.naver\.(com|net)$/.test(u.hostname))
}

/**
 * Blog id from a URL. Write-page URLs always belong to the signed-in user.
 * A plain blog URL (blog.naver.com/<id>) only counts when we got there by
 * opening MyBlog.naver, otherwise it might be someone else's blog.
 */
export function blogIdFromUrl(raw, { fromMyBlog = false, base = NAVER.base } = {}) {
  const u = parse(raw)
  const b = parse(base)
  if (!u || !b) return null
  const sameHost = u.host === b.host || (b.host === 'blog.naver.com' && u.host === 'm.blog.naver.com')
  if (!sameHost) return null
  const seg = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  if (seg[0] === 'PostWriteForm.naver') {
    const id = u.searchParams.get('blogId')
    return id && BLOG_ID.test(id) ? id : null
  }
  if (seg.length !== 1 || !BLOG_ID.test(seg[0])) return null
  if (u.searchParams.get('Redirect') === 'Write') return seg[0]
  return fromMyBlog ? seg[0] : null
}

export function writeUrlFor(blogId, base = NAVER.base) {
  return blogId && BLOG_ID.test(blogId) ? `${base}/${blogId}?Redirect=Write` : `${base}/GoBlogWrite.naver`
}

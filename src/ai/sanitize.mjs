// HTML allowlist sanitizer. Runs in Node (no DOM): tokenizes tags, keeps only
// a small set of formatting tags without attributes, escapes everything else.

export const ALLOWED_TAGS = Object.freeze(['p', 'h2', 'h3', 'b', 'strong', 'i', 'ul', 'ol', 'li', 'blockquote', 'br'])

// Tags renamed to an allowed equivalent.
const RENAME = { h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', em: 'i', div: 'p' }
// Tags dropped together with everything inside them.
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template',
  'noscript', 'head', 'title', 'textarea', 'select', 'button', 'form', 'video', 'audio', 'canvas', 'xml'])
const BLOCK = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote'])
const PARAGRAPH_LIKE = new Set(['p', 'h2', 'h3'])

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const ENTITY = /^&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i

// Inline photo placeholders a model may emit, e.g. ⟦사진 1⟧, [사진: 매장 외관], 📸.
const PHOTO_MARKER = /⟦[^⟧]{0,60}⟧|\[\s*(?:사진|이미지|그림|photo|image|img)[^\]]{0,60}\]|【\s*(?:사진|이미지)[^】]{0,60}】|\(\s*(?:사진|이미지)\s*(?:삽입|자리|위치|넣기)[^)]{0,40}\)|📸|📷|🖼️?/gi

function escapeText(text) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '&') {
      const m = ENTITY.exec(text.slice(i, i + 40))
      if (m) { out += m[0]; i += m[0].length - 1 } else out += '&amp;'
    } else if (ch === '<') out += '&lt;'
    else if (ch === '>') out += '&gt;'
    else out += ch
  }
  return out
}

export function stripPhotoMarkers(text) {
  return String(text).replace(PHOTO_MARKER, '')
}

/** Returns sanitized HTML that only contains ALLOWED_TAGS, all without attributes. */
export function sanitizeHtml(input) {
  const html = String(input ?? '')
  const stack = []
  let out = ''
  let dropping = null
  let dropDepth = 0
  let last = 0

  const close = (name) => {
    const at = stack.lastIndexOf(name)
    if (at < 0) return
    while (stack.length > at) out += `</${stack.pop()}>`
  }
  const emitText = (raw) => {
    if (dropping || !raw) return
    out += escapeText(stripPhotoMarkers(raw))
  }

  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(html); m; m = TOKEN.exec(html)) {
    emitText(html.slice(last, m.index))
    last = TOKEN.lastIndex
    if (!m[2]) continue // comment, doctype, cdata
    const closing = m[1] === '/'
    const raw = m[2].toLowerCase()
    const selfClosing = /\/\s*$/.test(m[3] ?? '')

    if (dropping) {
      if (raw === dropping) dropDepth += closing ? -1 : (selfClosing ? 0 : 1)
      if (dropDepth <= 0) dropping = null
      continue
    }
    if (DROP_WITH_CONTENT.has(raw)) {
      if (!closing && !selfClosing) { dropping = raw; dropDepth = 1 }
      continue
    }
    const name = RENAME[raw] ?? raw
    if (!ALLOWED_TAGS.includes(name)) continue
    if (name === 'br') { if (!closing) out += '<br>'; continue }
    if (closing) { close(name); continue }

    if (BLOCK.has(name)) {
      // A block cannot live inside a paragraph or heading: close those first.
      const inPara = stack.findLastIndex((t) => PARAGRAPH_LIKE.has(t))
      if (inPara >= 0) close(stack[inPara])
      if (name === 'li') {
        const list = stack.findLastIndex((t) => t === 'ul' || t === 'ol')
        if (list < 0) { stack.push('p'); out += '<p>'; continue }
        const openLi = stack.lastIndexOf('li')
        if (openLi > list) close('li')
      }
    }
    stack.push(name)
    out += `<${name}>`
  }
  emitText(html.slice(last))
  while (stack.length) out += `</${stack.pop()}>`

  // Drop blocks left empty (often after removing photo placeholders).
  let prev
  do {
    prev = out
    out = out.replace(/<(p|h2|h3|li|blockquote|b|strong|i)>(?:\s|&nbsp;|<br>)*<\/\1>/g, '')
      .replace(/<(ul|ol)>\s*<\/\1>/g, '')
  } while (out !== prev)
  return out.trim()
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(text) {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      try { return String.fromCodePoint(n) } catch { return all }
    }
    return NAMED[code.toLowerCase()] ?? all
  })
}

/** Plain-text rendering of sanitized HTML (one line per block). */
export function htmlToPlain(html) {
  const text = String(html ?? '')
    .replace(/<br>/g, '\n')
    .replace(/<li>/g, '- ')
    .replace(/<\/(p|h2|h3|li|blockquote|ul|ol)>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

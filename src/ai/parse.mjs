// Turns raw model text into a validated draft: {title, html, plain, tags, photos}.
import { sanitizeHtml, htmlToPlain, stripPhotoMarkers } from './sanitize.mjs'

export class ParseError extends Error {}

// Returns the first balanced {...} block, respecting JSON strings.
function firstObject(text) {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return { truncated: text.slice(start) }
}

// Escapes raw control characters that models sometimes leave inside strings.
function escapeControlsInStrings(json) {
  let out = ''
  let inString = false
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]
    if (inString) {
      if (ch === '\\') { out += ch + (json[i + 1] ?? ''); i++; continue }
      if (ch === '"') inString = false
      else if (ch === '\n') { out += '\\n'; continue }
      else if (ch === '\r') continue
      else if (ch === '\t') { out += '\\t'; continue }
    } else if (ch === '"') inString = true
    out += ch
  }
  return out
}

/** Extracts a JSON object from model output, repairing common mistakes. */
export function extractJson(raw) {
  const text = String(raw ?? '').replace(/^﻿/, '').replace(/```(?:json|JSON)?/g, '')
  const found = firstObject(text)
  if (!found) throw new ParseError('AI 답에서 글 내용을 찾지 못했어요. 다시 만들어 주세요.')
  if (typeof found === 'object') throw new ParseError('AI 답이 중간에 끊겼어요. 길이를 줄이거나 다시 만들어 주세요.')
  const attempts = [
    (s) => s,
    (s) => escapeControlsInStrings(s).replace(/,\s*([}\]])/g, '$1'),
    (s) => escapeControlsInStrings(s.replace(/[“”]/g, '"')).replace(/,\s*([}\]])/g, '$1'),
  ]
  for (const fix of attempts) {
    try {
      const value = JSON.parse(fix(found))
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    } catch { /* try the next repair */ }
  }
  throw new ParseError('AI 답의 형식이 올바르지 않아요. 다시 만들어 주세요.')
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const asList = (v) => Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []

function sectionsToHtml(sections) {
  let html = ''
  for (const s of Array.isArray(sections) ? sections : []) {
    if (typeof s === 'string') { html += `<p>${escapeHtml(s)}</p>`; continue }
    const heading = s?.heading ?? s?.h2 ?? s?.title ?? s?.subtitle
    if (heading) html += `<h2>${escapeHtml(heading)}</h2>`
    const body = s?.paragraphs ?? s?.body ?? s?.text ?? s?.content
    for (const p of Array.isArray(body) ? body : [body]) {
      if (typeof p === 'string' && p.trim()) html += /<\/?[a-z][^>]*>/i.test(p) ? p : `<p>${escapeHtml(p)}</p>`
    }
  }
  return html
}

function photoText(item) {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return ''
  const where = item.position ?? item.where ?? item.after_heading ?? item.location ?? ''
  const what = item.description ?? item.what ?? item.idea ?? item.subject ?? item.photo ?? ''
  return [where, what].filter(Boolean).join(' — ')
}

/** Validates a parsed object and returns a clean draft. Throws ParseError. */
export function normalizeDraft(obj) {
  const title = stripPhotoMarkers(String(obj?.title ?? obj?.['제목'] ?? '')).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)
  const rawBody = obj?.body_html ?? obj?.bodyHtml ?? obj?.html ?? obj?.body
  const bodySource = typeof rawBody === 'string' && rawBody.trim()
    ? (/<\/?[a-z][^>]*>/i.test(rawBody) ? rawBody : rawBody.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join(''))
    : sectionsToHtml(obj?.sections)
  const html = sanitizeHtml(bodySource)
  const plain = htmlToPlain(html)
  if (!title) throw new ParseError('AI 답에 제목이 없어요. 다시 만들어 주세요.')
  if (plain.replace(/\s/g, '').length < 50) throw new ParseError('AI 답의 본문이 너무 짧아요. 메모를 조금 더 적거나 다시 만들어 주세요.')

  const tags = []
  for (const t of asList(obj?.tags ?? obj?.hashtags)) {
    const tag = String(t ?? '').replace(/^#+/, '').replace(/[\s#,]+/g, '').slice(0, 25)
    if (tag && !tags.includes(tag)) tags.push(tag)
    if (tags.length >= 10) break
  }
  const photos = asList(obj?.photo_suggestions ?? obj?.photoSuggestions ?? obj?.photos)
    .map((p) => photoText(p).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 8)
  return { title, html, plain, tags, photos }
}

export function parseDraft(raw) {
  return normalizeDraft(extractJson(raw))
}

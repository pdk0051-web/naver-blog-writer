// Local settings in the app's user-data folder. API keys are encrypted with
// Electron safeStorage (Keychain on macOS, DPAPI on Windows) and never leave the
// main process; the panel only learns whether a key exists.
import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { ENGINES, DEFAULT_MODELS } from './ai/engines.mjs'

const PROVIDERS = ['gemini', 'anthropic', 'openai']
const file = () => path.join(app.getPath('userData'), 'settings.json')

function load() {
  try {
    const data = JSON.parse(readFileSync(file(), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch { return {} }
}

let cache = null
const current = () => (cache ??= load())

function save(next) {
  cache = next
  mkdirSync(path.dirname(file()), { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  renameSync(tmp, file())
}

export function getEngine() {
  const e = current().engine
  return Object.hasOwn(ENGINES, e) ? e : null
}

export function getModel(provider) {
  const m = current().models?.[provider]
  return typeof m === 'string' && m.trim() ? m.trim() : DEFAULT_MODELS[provider]
}

export function getBlogId() {
  const id = current().blogId
  return typeof id === 'string' && /^[A-Za-z0-9_-]{2,40}$/.test(id) ? id : null
}

export function setBlogId(id) {
  if (id !== null && !/^[A-Za-z0-9_-]{2,40}$/.test(String(id))) return
  if (current().blogId === id) return
  save({ ...current(), blogId: id })
}

export function updateSettings({ engine, models } = {}) {
  const next = { ...current() }
  if (engine !== undefined) {
    if (!Object.hasOwn(ENGINES, engine)) throw new Error('알 수 없는 AI 종류예요.')
    next.engine = engine
  }
  if (models && typeof models === 'object') {
    next.models = { ...next.models }
    for (const p of PROVIDERS) {
      if (typeof models[p] !== 'string') continue
      const m = models[p].trim()
      if (m && !/^[A-Za-z0-9._:/-]{1,80}$/.test(m)) throw new Error('모델 이름에는 영문·숫자·.-_:/ 만 쓸 수 있어요.')
      next.models[p] = m || DEFAULT_MODELS[p]
    }
  }
  save(next)
}

/** 'saved', 'broken' (stored but cannot be decrypted, e.g. after a profile move) or null. */
export function keyStatus(provider) {
  if (typeof current().keys?.[provider] !== 'string') return null
  return getKey(provider) ? 'saved' : 'broken'
}

export function setKey(provider, key) {
  if (!PROVIDERS.includes(provider)) throw new Error('알 수 없는 키 종류예요.')
  const value = String(key ?? '').trim()
  if (!value || value.length > 300 || /\s/.test(value)) throw new Error('키 모양이 올바르지 않아요. 복사한 키를 그대로 붙여 넣어 주세요.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서는 키를 안전하게 저장할 수 없어요.')
  const encrypted = safeStorage.encryptString(value).toString('base64')
  save({ ...current(), keys: { ...current().keys, [provider]: encrypted } })
}

export function clearKey(provider) {
  if (!PROVIDERS.includes(provider)) return
  const keys = { ...current().keys }
  delete keys[provider]
  save({ ...current(), keys })
}

export function getKey(provider) {
  const enc = current().keys?.[provider]
  if (typeof enc !== 'string') return null
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')) } catch { return null }
}

/** What the panel may see. Never includes keys. */
export function publicSettings() {
  return {
    engine: getEngine(),
    models: Object.fromEntries(PROVIDERS.map((p) => [p, getModel(p)])),
    keys: Object.fromEntries(PROVIDERS.map((p) => [p, keyStatus(p)])),
    blogId: getBlogId(),
  }
}

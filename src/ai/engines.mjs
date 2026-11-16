// AI engines: two subscription CLIs (Claude Code, Codex) and three API-key providers.
// Plain Node only (no Electron imports) so it can be tested and run from scripts.
import { spawn as nodeSpawn, execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { findExecutable, childPath, windowsCmdArgs } from './cli-path.mjs'

export const ENGINES = Object.freeze({
  'claude-cli': { label: 'Claude Code (구독 로그인)', kind: 'cli', bin: 'claude' },
  'codex-cli': { label: 'Codex (ChatGPT 구독 로그인)', kind: 'cli', bin: 'codex' },
  gemini: { label: 'Google Gemini API 키', kind: 'api' },
  anthropic: { label: 'Anthropic API 키', kind: 'api' },
  openai: { label: 'OpenAI API 키', kind: 'api' },
})

export const DEFAULT_MODELS = Object.freeze({
  gemini: 'gemini-3.8-flash',
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5-mini',
})

export const TIMEOUT_MS = 240_000
const MAX_OUTPUT = 2_000_000

export class EngineError extends Error {
  constructor(message, code = 'failed') { super(message); this.code = code }
}

const LOGIN_HINT = /not logged in|please (?:run|log ?in)|login required|\/login|authenticat(?:e|ion) (?:failed|required|error)|unauthori[sz]ed|\b401\b|invalid (?:api|x-api) key|oauth token/i
const LIMIT_HINT = /rate.?limit|usage limit|quota|too many requests|\b429\b|limit reached/i

function cliError(engine, stderr, stdout, code) {
  const text = `${stderr}\n${stdout}`
  const name = engine === 'claude-cli' ? 'claude' : 'codex'
  if (LOGIN_HINT.test(text)) return new EngineError(`로그인이 필요해요. 터미널에서 ${name} 를 한 번 실행해 로그인한 뒤 다시 눌러 주세요.`, 'login')
  if (LIMIT_HINT.test(text)) return new EngineError('구독 사용 한도에 걸렸어요. 잠시 뒤 다시 시도하거나 다른 AI를 골라 주세요.', 'limit')
  const tail = text.trim().split('\n').slice(-2).join(' ').slice(0, 160)
  return new EngineError(`${name} 실행이 실패했어요(종료 코드 ${code}). ${tail}`, 'failed')
}

/** Detects installed CLIs. Returns { 'claude-cli': {found, path}, 'codex-cli': {...} }. */
export function detectClis(opts = {}) {
  const out = {}
  for (const [id, def] of Object.entries(ENGINES)) {
    if (def.kind !== 'cli') continue
    const found = findExecutable(def.bin, opts)
    out[id] = { found: Boolean(found), path: found }
  }
  return out
}

/** Runs a CLI with an argument array, writing `input` to stdin. */
export function runProcess(file, args, { input = '', cwd, env, timeoutMs = TIMEOUT_MS, signal, spawn = nodeSpawn, platform = process.platform } = {}) {
  return new Promise((resolve, reject) => {
    const useCmd = platform === 'win32' && /\.(cmd|bat)$/i.test(file)
    const child = useCmd
      ? spawn(process.env.ComSpec || 'cmd.exe', windowsCmdArgs(file, args), { cwd, env, windowsVerbatimArguments: true, windowsHide: true })
      : spawn(file, args, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let done = false
    const kill = () => {
      if (platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
      else child.kill('SIGTERM')
    }
    const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); fn() } }
    const timer = setTimeout(() => { kill(); finish(() => reject(new EngineError(`AI 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았어요. 다시 시도해 주세요.`, 'timeout'))) }, timeoutMs)
    const onAbort = () => { kill(); finish(() => reject(new EngineError('만들기를 멈췄어요.', 'cancelled'))) }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener?.('abort', onAbort)
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d })
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d })
    child.on('error', (e) => finish(() => reject(new EngineError(`프로그램을 실행하지 못했어요: ${e.message}`, 'spawn'))))
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

async function runCli(engine, prompt, { cliPath, timeoutMs, signal, spawn } = {}) {
  const bin = cliPath || findExecutable(ENGINES[engine].bin)
  if (!bin) throw new EngineError(`${ENGINES[engine].bin} 프로그램을 찾지 못했어요. 설치했다면 'AI 연결' 탭에서 다시 찾기를 눌러 주세요.`, 'missing')
  // Empty scratch folder so the CLI never reads the user's files.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'nbw-'))
  const env = { ...process.env, PATH: childPath(), NO_COLOR: '1' }
  delete env.CLAUDECODE
  try {
    const args = engine === 'claude-cli'
      ? ['-p', '--output-format', 'text']
      : ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--output-last-message', 'last-message.txt', '-']
    const { code, stdout, stderr } = await runProcess(bin, args, { input: prompt, cwd, env, timeoutMs, signal, spawn })
    if (code !== 0) throw cliError(engine, stderr, stdout, code)
    if (engine === 'codex-cli') {
      const last = await readFile(path.join(cwd, 'last-message.txt'), 'utf8').catch(() => '')
      if (last.trim()) return last
    }
    if (!stdout.trim()) throw cliError(engine, stderr, stdout, code)
    return stdout
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {})
  }
}

function httpError(provider, status, bodyText) {
  const name = { gemini: 'Gemini', anthropic: 'Anthropic', openai: 'OpenAI' }[provider]
  if (status === 400 && /api key|API_KEY_INVALID/i.test(bodyText)) return new EngineError(`${name} 키가 올바르지 않아요. 'AI 연결' 탭에서 키를 다시 넣어 주세요.`, 'key')
  if (status === 401 || status === 403) return new EngineError(`${name} 키가 올바르지 않거나 권한이 없어요. 'AI 연결' 탭에서 확인해 주세요.`, 'key')
  if (status === 404) return new EngineError(`${name} 모델 이름을 찾을 수 없어요. 'AI 연결' 탭에서 모델 이름을 확인해 주세요.`, 'model')
  if (status === 429) return new EngineError(`${name} 사용 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.`, 'limit')
  if (status >= 500) return new EngineError(`${name} 서버가 잠시 불안정해요. 조금 뒤 다시 시도해 주세요.`, 'server')
  return new EngineError(`${name} 요청이 실패했어요(${status}). ${bodyText.slice(0, 160)}`, 'failed')
}

async function postJson(provider, url, headers, body, { fetchImpl = fetch, timeoutMs, signal }) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let res
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: combined })
  } catch (e) {
    if (signal?.aborted) throw new EngineError('만들기를 멈췄어요.', 'cancelled')
    if (timeout.aborted) throw new EngineError(`AI 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았어요. 다시 시도해 주세요.`, 'timeout')
    throw new EngineError('인터넷 연결을 확인해 주세요.', 'network')
  }
  const text = await res.text()
  if (!res.ok) throw httpError(provider, res.status, text)
  try { return JSON.parse(text) } catch { throw new EngineError('AI 서버의 답을 읽지 못했어요.', 'failed') }
}

async function runApi(provider, prompt, { apiKey, model, fetchImpl, timeoutMs, signal }) {
  if (!apiKey) throw new EngineError('API 키가 없어요. \'AI 연결\' 탭에서 키를 넣어 주세요.', 'key')
  const m = String(model || DEFAULT_MODELS[provider]).trim()
  if (!/^[A-Za-z0-9._:/-]{1,80}$/.test(m)) throw new EngineError('모델 이름이 올바르지 않아요.', 'model')
  const opts = { fetchImpl, timeoutMs, signal }
  if (provider === 'gemini') {
    const data = await postJson(provider, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
      { 'x-goog-api-key': apiKey },
      { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.8 } }, opts)
    const cand = data?.candidates?.[0]
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
    if (!text && /SAFETY|PROHIBITED|BLOCK/i.test(String(cand?.finishReason ?? data?.promptFeedback?.blockReason ?? ''))) {
      throw new EngineError('Gemini가 이 주제로는 글을 쓰지 않았어요(안전 필터). 주제나 메모를 바꿔 주세요.', 'blocked')
    }
    return text
  }
  if (provider === 'anthropic') {
    const data = await postJson(provider, 'https://api.anthropic.com/v1/messages',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      { model: m, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }, opts)
    if (data?.stop_reason === 'max_tokens') throw new EngineError('글이 너무 길어 AI 답이 중간에 끊겼어요. 길이를 «짧게»나 «보통»으로 바꿔 다시 만들어 주세요.', 'truncated')
    return (data?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('')
  }
  if (provider === 'openai') {
    const data = await postJson(provider, 'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${apiKey}` },
      { model: m, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }, opts)
    return data?.choices?.[0]?.message?.content ?? ''
  }
  throw new EngineError('알 수 없는 AI 종류예요.', 'engine')
}

/** Sends the prompt to the chosen engine and returns the raw text answer. */
export async function generate({ engine, prompt, apiKey, model, cliPath, timeoutMs = TIMEOUT_MS, signal, fetchImpl, spawn }) {
  if (!Object.hasOwn(ENGINES, engine)) throw new EngineError('AI를 먼저 골라 주세요.', 'engine')
  const text = ENGINES[engine].kind === 'cli'
    ? await runCli(engine, prompt, { cliPath, timeoutMs, signal, spawn })
    : await runApi(engine, prompt, { apiKey, model, fetchImpl, timeoutMs, signal })
  if (!String(text ?? '').trim()) throw new EngineError('AI가 빈 답을 보냈어요. 다시 시도해 주세요.', 'empty')
  return String(text)
}

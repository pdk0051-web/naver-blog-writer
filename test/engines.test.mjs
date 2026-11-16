import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { generate, runProcess, EngineError } from '../src/ai/engines.mjs'
import { findExecutable, searchDirs, windowsCmdArgs } from '../src/ai/cli-path.mjs'

function fakeSpawn({ stdout = '', stderr = '', code = 0, delay = 5 } = {}) {
  const calls = []
  const spawn = (file, args, opts) => {
    calls.push({ file, args, opts })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = Object.assign(new EventEmitter(), { end: (input) => { child.input = input } })
    child.kill = () => { child.killed = true }
    setTimeout(() => {
      if (stdout) child.stdout.emit('data', stdout)
      if (stderr) child.stderr.emit('data', stderr)
      child.emit('close', code)
    }, delay)
    calls.at(-1).child = child
    return child
  }
  return { spawn, calls }
}

test('CLI gets the prompt on stdin and arguments as an array', async () => {
  const { spawn, calls } = fakeSpawn({ stdout: '{"title":"t"}' })
  const out = await generate({ engine: 'claude-cli', prompt: '프롬프트 "따옴표" $(rm -rf)', cliPath: '/bin/claude', spawn })
  assert.equal(out, '{"title":"t"}')
  assert.equal(calls[0].file, '/bin/claude')
  assert.deepEqual(calls[0].args, ['-p', '--output-format', 'text'])
  assert.equal(calls[0].child.input, '프롬프트 "따옴표" $(rm -rf)')
  assert.ok(!('shell' in calls[0].opts) || calls[0].opts.shell === false)
})

test('CLI login failure becomes a Korean login message', async () => {
  const { spawn } = fakeSpawn({ stderr: 'Error: Not logged in. Please run /login', code: 1 })
  await assert.rejects(generate({ engine: 'claude-cli', prompt: 'x', cliPath: '/bin/claude', spawn }),
    (e) => e instanceof EngineError && e.code === 'login' && /로그인이 필요해요/.test(e.message))
})

test('CLI timeout kills the process', async () => {
  const { spawn, calls } = fakeSpawn({ stdout: 'late', delay: 500 })
  await assert.rejects(runProcess('/bin/x', [], { spawn, timeoutMs: 50, platform: 'darwin' }), (e) => e.code === 'timeout')
  assert.ok(calls[0].child.killed)
})

test('Windows .cmd shims go through cmd.exe with fixed quoted args', async () => {
  const { spawn, calls } = fakeSpawn({ stdout: 'ok' })
  await runProcess('C:\\Users\\A B\\AppData\\Roaming\\npm\\codex.cmd', ['exec', '-'], { spawn, platform: 'win32' })
  assert.match(calls[0].file, /cmd(\.exe)?$/i)
  assert.deepEqual(calls[0].args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(calls[0].args[3], '""C:\\Users\\A B\\AppData\\Roaming\\npm\\codex.cmd" "exec" "-""')
  assert.throws(() => windowsCmdArgs('a.cmd', ['%PATH%']))
})

test('Gemini request shape and key header', async () => {
  let seen
  const fetchImpl = async (url, init) => {
    seen = { url, init }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"title":"g"}' }] } }] }), { status: 200 })
  }
  const out = await generate({ engine: 'gemini', prompt: 'p', apiKey: 'k-123', model: 'gemini-test', fetchImpl })
  assert.equal(out, '{"title":"g"}')
  assert.match(seen.url, /models\/gemini-test:generateContent$/)
  assert.equal(seen.init.headers['x-goog-api-key'], 'k-123')
  assert.ok(!seen.url.includes('k-123'), 'key must not be in the URL')
  assert.equal(JSON.parse(seen.init.body).generationConfig.responseMimeType, 'application/json')
})

test('Anthropic and OpenAI request shapes', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, init })
    const body = url.includes('anthropic') ? { content: [{ type: 'text', text: 'A' }] } : { choices: [{ message: { content: 'O' } }] }
    return new Response(JSON.stringify(body), { status: 200 })
  }
  assert.equal(await generate({ engine: 'anthropic', prompt: 'p', apiKey: 'ak', fetchImpl }), 'A')
  assert.equal(await generate({ engine: 'openai', prompt: 'p', apiKey: 'ok', model: 'my-model', fetchImpl }), 'O')
  assert.equal(seen[0].init.headers['x-api-key'], 'ak')
  assert.equal(JSON.parse(seen[0].init.body).model, 'claude-sonnet-5-5')
  assert.equal(seen[1].init.headers.authorization, 'Bearer ok')
  assert.equal(JSON.parse(seen[1].init.body).model, 'my-model')
})

test('HTTP errors map to Korean messages', async () => {
  const respond = (status, text) => async () => new Response(text, { status })
  await assert.rejects(generate({ engine: 'gemini', prompt: 'p', apiKey: 'k', fetchImpl: respond(400, 'API key not valid. API_KEY_INVALID') }), (e) => e.code === 'key')
  await assert.rejects(generate({ engine: 'gemini', prompt: 'p', apiKey: 'k', fetchImpl: respond(429, 'quota') }), (e) => e.code === 'limit')
  await assert.rejects(generate({ engine: 'openai', prompt: 'p', apiKey: 'k', fetchImpl: respond(404, 'no model') }), (e) => e.code === 'model')
  await assert.rejects(generate({ engine: 'gemini', prompt: 'p', apiKey: '' }), (e) => e.code === 'key')
})

test('PATH search includes Homebrew/npm folders on macOS and npm on Windows', () => {
  const mac = searchDirs({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/u', fs: { list: () => ['v20.1.0', 'v22.3.0'] } })
  assert.ok(mac.includes('/opt/homebrew/bin'))
  assert.ok(mac.includes('/Users/u/.local/bin'))
  assert.ok(mac.indexOf('/Users/u/.nvm/versions/node/v22.3.0/bin') < mac.indexOf('/Users/u/.nvm/versions/node/v20.1.0/bin'))
  const win = searchDirs({ platform: 'win32', env: { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home: 'C:\\Users\\u', fs: { list: () => [] } })
  assert.ok(win.includes('C:\\Users\\u\\AppData\\Roaming\\npm'))
  assert.ok(mac.includes('/Users/u/.local/share/mise/shims') && mac.includes('/Users/u/.asdf/shims') && mac.includes('/Users/u/.volta/bin'))
})

test('findExecutable prefers .exe on Windows', () => {
  const files = new Set(['C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\Users\\u\\.local\\bin\\claude.exe'])
  const found = findExecutable('claude', { platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home: 'C:\\Users\\u', fs: { isFile: (p) => files.has(p), list: () => [] } })
  assert.equal(found, 'C:\\Users\\u\\.local\\bin\\claude.exe')
  assert.equal(findExecutable('nope', { platform: 'darwin', env: {}, home: '/h', fs: { isFile: () => false, list: () => [] } }), null)
})

test('Anthropic truncated answer gives a clear Korean message', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"title":' }] }), { status: 200 })
  await assert.rejects(generate({ engine: 'anthropic', prompt: 'p', apiKey: 'k', fetchImpl }), (e) => e.code === 'truncated' && /끊겼어요/.test(e.message))
})

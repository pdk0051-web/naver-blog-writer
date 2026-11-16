// Finds AI command-line tools. Apps opened from Finder/Start menu do not get the
// shell's PATH, so common install folders (Homebrew, npm global, nvm...) are added.
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const defaultFs = {
  isFile: (p) => { try { return statSync(p).isFile() } catch { return false } },
  list: (dir) => { try { return readdirSync(dir) } catch { return [] } },
  exists: existsSync,
}

/** Ordered list of folders to search for CLIs on this platform. */
export function searchDirs({ platform = process.platform, env = process.env, home = os.homedir(), fs = defaultFs } = {}) {
  const win = platform === 'win32'
  const p = win ? path.win32 : path.posix
  const fromPath = String(env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean)
  const extra = []
  if (win) {
    const appData = env.APPDATA ?? p.join(home, 'AppData', 'Roaming')
    const local = env.LOCALAPPDATA ?? p.join(home, 'AppData', 'Local')
    extra.push(p.join(home, '.local', 'bin'), p.join(appData, 'npm'), p.join(local, 'pnpm'),
      p.join(home, '.bun', 'bin'), p.join(local, 'Volta', 'bin'), p.join(local, 'mise', 'shims'),
      p.join(appData, 'fnm', 'aliases', 'default'), p.join(env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'))
  } else {
    extra.push(p.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', p.join(home, '.npm-global', 'bin'),
      p.join(home, '.claude', 'local'), p.join(home, '.volta', 'bin'), p.join(home, '.bun', 'bin'),
      p.join(home, 'Library', 'pnpm'), p.join(home, '.local', 'share', 'pnpm'), p.join(home, 'n', 'bin'),
      // Version-manager shims: mise, asdf, fnm (default alias).
      p.join(home, '.local', 'share', 'mise', 'shims'), p.join(home, '.asdf', 'shims'),
      p.join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin'),
      p.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'), '/usr/bin', '/bin')
    const nvm = p.join(home, '.nvm', 'versions', 'node')
    const versions = fs.list(nvm).filter((v) => /^v\d/.test(v))
      .sort((a, b) => b.slice(1).localeCompare(a.slice(1), undefined, { numeric: true }))
    for (const v of versions) extra.push(p.join(nvm, v, 'bin'))
  }
  return [...new Set([...fromPath, ...extra])]
}

/** Full path of an executable, or null. On Windows .exe is preferred over .cmd. */
export function findExecutable(name, opts = {}) {
  const platform = opts.platform ?? process.platform
  const fs = opts.fs ?? defaultFs
  const p = platform === 'win32' ? path.win32 : path.posix
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  for (const dir of searchDirs({ ...opts, platform, fs })) {
    for (const ext of exts) {
      const full = p.join(dir, name + ext)
      if (fs.isFile(full)) return full
    }
  }
  return null
}

/** PATH value for child processes, so CLIs written in Node can find `node`. */
export function childPath(opts = {}) {
  const platform = opts.platform ?? process.platform
  return searchDirs({ ...opts, platform }).join(platform === 'win32' ? ';' : ':')
}

/**
 * Windows .cmd shims must run through cmd.exe. Only fixed arguments ever go
 * here (the prompt is sent on stdin), and each one is quoted. Inside quotes
 * cmd.exe treats & | < > ^ literally; only % and " are refused.
 */
export function windowsCmdArgs(file, args) {
  for (const a of [file, ...args]) {
    if (/["%\r\n]/.test(a)) throw new Error(`unsafe argument for cmd.exe: ${a}`)
  }
  const line = [file, ...args].map((a) => `"${a}"`).join(' ')
  return ['/d', '/s', '/c', `"${line}"`]
}

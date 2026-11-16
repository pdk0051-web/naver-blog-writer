// Bridge for the right panel only (the Naver view has no preload).
// Actions that touch Naver, the clipboard, keys or links run only right after
// a real click (navigator.userActivation), never on their own.
// Sandboxed preloads must be CommonJS, hence .cjs.
const { contextBridge, ipcRenderer } = require('electron')

const call = (channel, payload) => ipcRenderer.invoke(channel, payload)
const onClick = (channel, payload) => {
  if (!navigator.userActivation || !navigator.userActivation.isActive) {
    return Promise.resolve({ ok: false, error: '버튼을 눌렀을 때만 할 수 있어요.' })
  }
  return ipcRenderer.invoke(channel, payload)
}

contextBridge.exposeInMainWorld('writer', {
  init: () => call('app:init'),
  detectEngines: () => call('engines:detect'),
  saveSettings: (engine, models) => call('settings:save', { engine, models }),
  setKey: (provider, key) => onClick('key:set', { provider, key }),
  clearKey: (provider) => onClick('key:clear', { provider }),
  generate: (input) => onClick('draft:generate', input),
  cancel: () => call('draft:cancel'),
  insert: (title, html) => onClick('editor:insert', { title, html }),
  tempSave: () => onClick('editor:save'),
  naverGo: (where) => onClick('naver:go', { where }),
  naverBack: () => onClick('naver:back'),
  naverReload: () => onClick('naver:reload'),
  naverLogout: () => onClick('naver:logout'),
  copyText: (text) => onClick('copy:text', { text }),
  openLink: (id) => onClick('link:open', { id }),
  onNaverStatus: (fn) => ipcRenderer.on('naver:status', (_e, status) => fn(status)),
})

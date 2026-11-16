// Right panel UI. Talks to the main process only through window.writer (preload).
const api = window.writer
const $ = (id) => document.getElementById(id)
const FORM_KEY = 'nbw-form-v1'

const state = {
  info: null,
  form: { topic: '', kind: 'info', tone: 'haeyo', length: 'normal', memo: '', keywords: '' },
  busy: false,
  draft: null,
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return node
}

function showMsg(target, kind, text) {
  const box = $(target)
  box.className = `msg ${kind}`
  box.textContent = text || ''
}

// ---------- tabs ----------
function openTab(name) {
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name))
  for (const s of document.querySelectorAll('main > .tab')) s.hidden = s.id !== `tab-${name}`
}
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => openTab(b.dataset.tab))
for (const b of document.querySelectorAll('[data-open-tab]')) b.addEventListener('click', () => openTab(b.dataset.openTab))

// ---------- Naver navigation ----------
for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => api.naverGo(b.dataset.go))
$('navBack').addEventListener('click', () => api.naverBack())
$('navReload').addEventListener('click', () => api.naverReload())

function renderNaver(status) {
  const chip = $('naverChip')
  if (status?.login === true) { chip.textContent = '네이버 로그인 필요'; chip.className = 'chip need' }
  else if (status?.blogId) { chip.textContent = `네이버 로그인됨 · ${status.blogId}`; chip.className = 'chip ok' }
  else { chip.textContent = '네이버 확인 중'; chip.className = 'chip' }
  $('naverInfo').textContent = status?.blogId
    ? `블로그 아이디: ${status.blogId}. 이 앱 안의 네이버 로그인만 지우려면 아래 버튼을 눌러 주세요.`
    : '왼쪽 화면에서 로그인하면 블로그 아이디를 자동으로 알아내요.'
}
api.onNaverStatus(renderNaver)

$('btnLogout').addEventListener('click', async () => {
  const r = await api.naverLogout()
  showMsg('aiMsg', r.ok ? 'ok' : 'error', r.ok ? '이 앱에서 네이버 로그아웃했어요.' : r.error)
})

// ---------- form ----------
function saveForm() {
  try { localStorage.setItem(FORM_KEY, JSON.stringify(state.form)) } catch { /* storage full or disabled */ }
}

function loadForm() {
  try { Object.assign(state.form, JSON.parse(localStorage.getItem(FORM_KEY) || '{}')) } catch { /* ignore broken data */ }
}

function renderChoices(id, options, key) {
  const box = $(id)
  box.replaceChildren(...Object.entries(options).map(([value, label]) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(state.form[key] === value), 'data-value': value,
    onclick: () => { state.form[key] = value; saveForm(); renderChoices(id, options, key) },
  }, label)))
}

for (const key of ['topic', 'memo', 'keywords']) {
  $(key).addEventListener('input', () => { state.form[key] = $(key).value; saveForm() })
}

// ---------- generation ----------
function setBusy(busy) {
  state.busy = busy
  for (const id of ['btnGenerate', 'btnRegen', 'btnInsert', 'btnSave']) $(id).disabled = busy
  $('btnCancel').hidden = !busy
}

async function runGenerate() {
  if (state.busy) return
  if (!state.form.topic.trim()) { showMsg('msg', 'error', '주제를 적어 주세요.'); $('topic').focus(); return }
  setBusy(true)
  showMsg('msg', 'info', '글을 만들고 있어요. 보통 30초~2분 걸려요.')
  try {
    const r = await api.generate({ ...state.form })
    if (!r.ok) { showMsg('msg', 'error', r.error); return }
    state.draft = r.draft
    renderPreview()
    showMsg('msg', 'ok', '초안이 나왔어요. 아래에서 읽고 고친 뒤 «편집기에 넣기»를 눌러 주세요.')
  } finally {
    setBusy(false)
  }
}
$('btnGenerate').addEventListener('click', runGenerate)
$('btnRegen').addEventListener('click', runGenerate)
$('btnCancel').addEventListener('click', () => api.cancel())

function countChars() {
  const n = $('pBody').innerText.replace(/\s/g, '').length
  $('pCount').textContent = `공백 빼고 ${n.toLocaleString('ko-KR')}자`
}

function renderPreview() {
  const d = state.draft
  $('preview').hidden = false
  $('pTitle').value = d.title
  // d.html is already reduced to a few plain formatting tags by the main process.
  $('pBody').innerHTML = d.html
  countChars()
  $('pHints').hidden = !d.hints.length
  $('pHints').replaceChildren(...d.hints.map((h) => el('li', {}, h)))
  $('pTags').replaceChildren(...d.tags.map((t) => el('span', {}, `#${t}`)))
  $('pPhotos').replaceChildren(...(d.photos.length ? d.photos : ['추천이 없어요.']).map((p) => el('li', {}, p)))
}
$('pBody').addEventListener('input', countChars)

$('btnCopyTags').addEventListener('click', async () => {
  if (!state.draft) return
  const r = await api.copyText(state.draft.tags.map((t) => `#${t}`).join(' '))
  showMsg('msg', r.ok ? 'ok' : 'error', r.ok ? '태그를 복사했어요.' : r.error)
})

$('btnInsert').addEventListener('click', async () => {
  if (state.busy) return
  setBusy(true)
  showMsg('msg', 'info', '왼쪽 편집기에 넣고 있어요. 끝날 때까지 왼쪽 화면을 누르지 말아 주세요.')
  try {
    const r = await api.insert($('pTitle').value, $('pBody').innerHTML)
    showMsg('msg', r.ok ? 'ok' : 'error', r.ok ? r.message : r.error)
  } finally {
    setBusy(false)
  }
})

$('btnSave').addEventListener('click', async () => {
  if (state.busy) return
  setBusy(true)
  showMsg('msg', 'info', '임시저장하고 있어요.')
  try {
    const r = await api.tempSave()
    showMsg('msg', r.ok ? 'ok' : 'error', r.ok ? r.message : r.error)
  } finally {
    setBusy(false)
  }
})

// ---------- AI engines tab ----------
const ENGINE_NOTES = {
  'claude-cli': {
    text: 'Claude 유료 구독(Pro·Max)이 있으면 추가 비용 없이 쓸 수 있어요. 컴퓨터에 Claude Code를 설치하고 터미널에서 claude 를 한 번 실행해 로그인해 두면 돼요.',
    link: ['claudeCode', '설치 방법 보기'],
  },
  'codex-cli': {
    text: 'ChatGPT 유료 구독이 있으면 쓸 수 있어요. Codex를 설치하고 터미널에서 codex login 으로 로그인해 두면 돼요.',
    link: ['codex', '설치 방법 보기'],
  },
  gemini: {
    steps: ['아래 «키 받는 곳 열기»를 눌러요.', '구글 계정으로 로그인하고 «API 키 만들기»를 눌러요.', '만들어진 키를 복사해서 아래 칸에 붙여 넣고 «저장»을 눌러요.'],
    link: ['geminiKey', '키 받는 곳 열기'],
  },
  anthropic: { text: '사용한 만큼 요금이 나가는 API 키예요.', link: ['anthropicKey', '키 받는 곳 열기'] },
  openai: { text: '사용한 만큼 요금이 나가는 API 키예요.', link: ['openaiKey', '키 받는 곳 열기'] },
}

function engineLabel(id) {
  const e = state.info.engines.find((x) => x.id === id)
  if (!e) return '고르지 않음'
  const model = e.kind === 'api' ? ` · ${state.info.settings.models[id]}` : ''
  return `${e.label}${model}`
}

function renderEngines() {
  const { engines, settings, clis } = state.info
  $('engineName').textContent = engineLabel(settings.engine)
  $('engineList').replaceChildren(...engines.map((e) => {
    const selected = settings.engine === e.id
    const badges = []
    if (e.id === 'gemini') badges.push(el('span', { class: 'badge rec' }, '추천 · 무료로 시작'))
    if (e.kind === 'cli') badges.push(clis[e.id]?.found ? el('span', { class: 'badge good' }, '찾음') : el('span', { class: 'badge' }, '설치 안 됨'))
    else if (settings.keys[e.id] === 'saved') badges.push(el('span', { class: 'badge good' }, '키 저장됨'))
    else if (settings.keys[e.id] === 'broken') badges.push(el('span', { class: 'badge warn' }, '키를 다시 넣어 주세요'))
    else badges.push(el('span', { class: 'badge' }, '키 없음'))

    const note = ENGINE_NOTES[e.id]
    const body = el('div', { class: 'engine-body' })
    if (note.text) body.append(el('div', {}, note.text))
    if (note.steps) body.append(el('ol', {}, note.steps.map((s) => el('li', {}, s))))
    body.append(el('div', {}, el('button', { type: 'button', class: 'link', onclick: () => api.openLink(note.link[0]) }, note.link[1])))
    if (e.kind === 'cli' && clis[e.id]?.path) body.append(el('div', { class: 'path' }, clis[e.id].path))
    if (e.kind === 'api') {
      const keyInput = el('input', { type: 'password', placeholder: settings.keys[e.id] === 'saved' ? '저장된 키가 있어요. 바꾸려면 새 키를 넣어 주세요.' : '여기에 키를 붙여 넣어 주세요', autocomplete: 'off', spellcheck: 'false' })
      body.append(el('div', { class: 'key-row' }, keyInput,
        el('button', { type: 'button', onclick: async () => {
          const r = await api.setKey(e.id, keyInput.value)
          if (r.ok) { state.info.settings = r.settings; keyInput.value = ''; await chooseEngine(e.id); showMsg('aiMsg', 'ok', '키를 이 컴퓨터에 안전하게 저장했어요.') }
          else showMsg('aiMsg', 'error', r.error)
        } }, '저장'),
        el('button', { type: 'button', onclick: async () => {
          const r = await api.clearKey(e.id)
          if (r.ok) { state.info.settings = r.settings; renderEngines(); showMsg('aiMsg', 'ok', '키를 지웠어요.') }
          else showMsg('aiMsg', 'error', r.error)
        } }, '지우기')))
      const modelInput = el('input', { value: settings.models[e.id], spellcheck: 'false', 'aria-label': '모델 이름' })
      modelInput.addEventListener('change', async () => {
        const r = await api.saveSettings(undefined, { [e.id]: modelInput.value })
        if (r.ok) { state.info.settings = r.settings; renderEngines(); showMsg('aiMsg', 'ok', '모델 이름을 바꿨어요.') }
        else showMsg('aiMsg', 'error', r.error)
      })
      body.append(el('div', { class: 'model-row' }, el('span', {}, '모델'), modelInput))
    }

    const radio = el('input', { type: 'radio', name: 'engine', value: e.id })
    radio.checked = selected
    radio.addEventListener('change', () => chooseEngine(e.id))
    return el('div', { class: `engine${selected ? ' selected' : ''}` },
      el('label', { class: 'engine-head' }, radio, el('span', { class: 'name' }, e.label), ...badges), body)
  }))
}

async function chooseEngine(id) {
  const r = await api.saveSettings(id)
  if (r.ok) state.info.settings = r.settings
  else showMsg('aiMsg', 'error', r.error)
  renderEngines()
}

$('btnDetect').addEventListener('click', async () => {
  const r = await api.detectEngines()
  if (r.ok) { state.info.clis = r.clis; renderEngines(); showMsg('aiMsg', 'ok', '다시 찾았어요.') }
})

// ---------- start ----------
async function start() {
  const r = await api.init()
  if (!r.ok) { showMsg('msg', 'error', r.error); return }
  state.info = r
  loadForm()
  $('topic').value = state.form.topic
  $('memo').value = state.form.memo
  $('keywords').value = state.form.keywords
  renderChoices('kind', r.kinds, 'kind')
  renderChoices('tone', r.tones, 'tone')
  renderChoices('length', r.lengths, 'length')
  renderEngines()
  renderNaver(r.naver)
  $('versionLine').textContent = `버전 ${r.version}`
  if (!r.settings.engine) showMsg('msg', 'info', "처음이라면 'AI 연결' 탭에서 쓸 AI부터 골라 주세요.")
  document.body.dataset.ready = '1'
}
start()

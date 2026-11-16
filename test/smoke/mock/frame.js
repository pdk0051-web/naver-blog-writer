// Mock of the SmartEditor ONE frame: records every button click, splits pasted
// HTML into text components, and confirms «저장» with a counter + toast.
window.__log = []
window.__published = false
let saved = 0

const wrap = document.querySelector('.se-components-wrap')
const syncPlaceholders = () => {
  for (const comp of document.querySelectorAll('.se-component')) {
    const ph = comp.querySelector('.se-placeholder')
    if (ph) ph.style.display = comp.innerText.replace(ph.innerText, '').trim() ? 'none' : ''
  }
}
document.addEventListener('input', syncPlaceholders)

document.addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  window.__log.push(b.textContent.trim())
  if (/publish_btn/.test(b.className)) window.__published = true
  if (/save_btn__/.test(b.className) && b.textContent.trim() === '저장') {
    saved += 1
    document.querySelector('[class^="save_count_btn"]').setAttribute('aria-label', `임시저장된 글 보기, ${saved}개`)
    const toast = document.querySelector('.toast_area')
    toast.textContent = '임시저장 완료'
    toast.style.display = 'block'
    setTimeout(() => { toast.style.display = 'none' }, 2500)
  }
}, true)

// Like the real editor, pasted blocks become separate components.
document.addEventListener('paste', (e) => {
  const target = e.target.closest?.('.se-component.se-text .se-text-paragraph')
  if (!target) return
  e.preventDefault()
  const html = e.clipboardData.getData('text/html')
  window.__pastedHtml = html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let anchor = target.closest('.se-component')
  anchor.remove()
  const blocks = [...doc.body.children]
  let prev = wrap.querySelector('.se-documentTitle')
  for (const block of blocks) {
    const comp = document.createElement('div')
    comp.className = `se-component se-text ${/^H[23]$/.test(block.tagName) ? 'se-heading' : ''}`
    const p = document.createElement('p')
    p.className = 'se-text-paragraph'
    p.contentEditable = 'true'
    p.innerHTML = block.innerHTML
    comp.append(p)
    prev.after(comp)
    prev = comp
  }
  anchor = null
  syncPlaceholders()
})

if (new URLSearchParams(location.search).get('popup') === '1') {
  const pop = document.createElement('div')
  pop.className = 'se-popup'
  pop.innerHTML = '<strong class="se-popup-title">작성 중인 글이 있습니다.</strong><p>이어서 작성하시겠습니까?</p><button class="se-popup-button-cancel">취소</button><button class="se-popup-button-confirm">확인</button>'
  document.body.append(pop)
}

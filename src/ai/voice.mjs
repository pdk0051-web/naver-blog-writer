// Generic Korean blog writing guide for the model, plus light after-the-fact hints.
// The guide describes patterns in words on purpose: example sentences inside a
// prompt tend to get copied into the output verbatim.

export function writingGuide(tone) {
  const voice = tone === 'hapsho'
    ? '말투는 정돈된 합쇼체(~습니다, ~합니다)로 끝까지 통일한다. 딱딱한 보고서가 아니라 친절한 안내글처럼 쓴다.'
    : '말투는 친근한 해요체(~해요, ~예요, ~더라고요)로 끝까지 통일한다. 친구에게 이야기하듯 편하게 쓰고, 문장 끝을 ~다로 맺는 평서문을 섞지 않는다.'
  return [
    '[글쓰기 원칙]',
    '- 너는 네이버 블로그에 글을 쓰는 평범한 한국인 블로거다. 사람이 쓴 블로그 글처럼 자연스럽게 쓴다.',
    `- ${voice}`,
    '- 문장 길이를 섞는다. 같은 어미가 세 문장 넘게 연달아 나오지 않게 한다.',
    '- 첫 문단에서 이 글이 무엇을 알려 주는지 바로 말한다. 인사말·자기소개로 길게 시작하지 않는다.',
    '- 글쓴이의 직접 경험(가 봤다, 써 봤다, 먹어 봤다, 느꼈다)은 [내 메모]에 적힌 것만 쓴다. 메모에 없는 경험·후기·감상을 지어내지 않는다.',
    '- 가격·날짜·시간·수량·통계 같은 숫자는 [내 메모]나 [키워드]에 있는 것만 쓴다. 모르는 숫자는 쓰지 말고, 필요하면 확인해 보라고 한 번만 안내한다.',
    '- 확실하지 않은 일반 정보는 단정하지 않는다. 그렇다고 모든 문장에 단서를 붙이지도 않는다.',
    '- 소제목은 내용을 말해 주는 짧은 구절로 쓴다. 소제목이나 제목에 숫자로 보는, 숫자에서 보이는 같은 표현을 쓰지 않는다.',
    '- 글을 쓰는 과정이나 자료에 대한 말(제공된 자료, 주어진 메모, 요청하신 내용, AI로서)을 본문에 쓰지 않는다.',
    '- 결론적으로, 요약하자면, 마무리하며 같은 정리 상투구와, 다음 글에서 알려 드리겠다는 약속을 쓰지 않는다.',
    '- 과장된 수식어(최고의, 완벽한, 놀라운, 혁신적인)와 이모지를 남발하지 않는다. 이모지는 쓰지 않는 쪽을 기본으로 한다.',
    '- 광고·협찬·제품 제공을 받았다는 내용이 메모에 있으면 글 첫 문단에 그 사실을 분명히 밝힌다.',
    '- 남의 글·기사 문장을 그대로 옮기지 않는다. 본문에 사진 자리 표시(대괄호 안의 사진, 이미지 같은 글자)를 넣지 않는다.',
  ].join('\n')
}

const META_TALK = /제공(된|해 주신) (자료|정보|메모)|주어진 (자료|정보|메모)|요청하신|AI로서|인공지능으로서|언어 모델/
const NUMBER_FRAME = /숫자로 보는|숫자에서 보이는|숫자로 본/
const WRAP_UP = /결론적으로|요약하자면|정리하자면|마무리하며/
const PROMISE = /다음 (글|포스팅)에서|추후에? (알려|업데이트)|후기를? 올리겠|업데이트하겠/

/** Returns short Korean hints about common AI tells in a draft (never blocks). */
export function voiceHints(plain, tone) {
  const text = String(plain ?? '')
  const hints = []
  if (NUMBER_FRAME.test(text)) hints.push('«숫자로 보는» 같은 표현이 있어요. 사람이 쓴 글에선 드문 말이에요.')
  if (META_TALK.test(text)) hints.push('«제공된 자료» 같은 작성 과정 말이 들어 있어요. 지우는 게 자연스러워요.')
  if (WRAP_UP.test(text)) hints.push('«결론적으로» 같은 정리 상투구가 있어요.')
  if (PROMISE.test(text)) hints.push('«다음 글에서 알려 드릴게요» 같은 약속 문장이 있어요. 지킬 계획이 없다면 빼 주세요.')
  if (tone !== 'hapsho') {
    const endings = text.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8)
    const plainDa = endings.filter((s) => /다[.!]?$/.test(s) && !/(니다|습니다|ㅂ니다)[.!]?$/.test(s)).length
    if (endings.length >= 6 && plainDa / endings.length > 0.3) hints.push('해요체 글인데 «~다»로 끝나는 문장이 많아요. 말투가 섞여 보일 수 있어요.')
  }
  return hints
}

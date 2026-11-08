import type { FilterId, Subtitle, SubtitleEffect, TimelineItem, TransitionId } from './types'
import { DEFAULT_FADE_SECONDS } from './types'
import type { Template } from './templates'

/**
 * 스타일 템플릿 (FR-049).
 *
 * 올릴 곳 템플릿(FR-045)이 "어디에 맞출까"라면 스타일은 "어떤 느낌으로"다.
 * 자막 꾸미기(FR-046)·색감·전환(FR-047)은 원래 자막·클립마다 따로 고르는데,
 * 처음 만드는 사람은 무엇을 어떻게 조합해야 할지 모른다. 그래서 어울리는
 * 조합을 이름 붙여 한 번에 고르게 한다. 고른 뒤에도 하나하나 바꿀 수 있다.
 */
export type StyleId = 'clean' | 'variety' | 'mood' | 'info' | 'retro' | 'neon'

export interface StyleTemplate {
  id: StyleId
  label: string
  hint: string
  /** 이 스타일로 새로 넣는 자막의 꾸미기. 위치는 자막마다 다르므로 넣지 않는다 */
  subtitleEffect: Omit<SubtitleEffect, 'position'>
  filter: FilterId
  transition: TransitionId
  /** 컷 사이 페이드를 기본 길이로 걸어 전환이 보이게 할지 */
  seamFade: boolean
}

export const STYLES: Record<StyleId, StyleTemplate> = {
  clean: {
    id: 'clean',
    label: '깔끔',
    hint: '효과 없이 또렷한 자막',
    subtitleEffect: { preset: 'basic', animation: 'none' },
    filter: 'none',
    transition: 'black',
    seamFade: false,
  },
  variety: {
    id: 'variety',
    label: '예능',
    hint: '굵은 자막이 톡, 말하는 단어 강조',
    subtitleEffect: { preset: 'variety', animation: 'pop', highlight: true },
    filter: 'vivid',
    transition: 'white',
    seamFade: true,
  },
  mood: {
    id: 'mood',
    label: '감성',
    hint: '따뜻한 색감, 서서히 흐려지는 전환',
    subtitleEffect: { preset: 'basic', animation: 'fade' },
    filter: 'warm',
    transition: 'blur',
    seamFade: true,
  },
  info: {
    id: 'info',
    label: '정보 전달',
    hint: '수업·설명용 뉴스 자막, 밀어내기 전환',
    subtitleEffect: { preset: 'news', animation: 'slide' },
    filter: 'none',
    transition: 'slide',
    seamFade: true,
  },
  retro: {
    id: 'retro',
    label: '레트로',
    hint: '빈티지 색감, 타자 치듯 나오는 말풍선',
    subtitleEffect: { preset: 'bubble', animation: 'typing' },
    filter: 'vintage',
    transition: 'black',
    seamFade: true,
  },
  neon: {
    id: 'neon',
    label: '네온',
    hint: '빛나는 자막, 확대 전환',
    subtitleEffect: { preset: 'neon', animation: 'pop', highlight: true },
    filter: 'cool',
    transition: 'zoom',
    seamFade: true,
  },
}

/** 종류마다 어울리는 스타일만 보여 준다. 고를 것이 많으면 오히려 못 고른다. */
export const STYLES_BY_KIND: Record<Template['id'], StyleId[]> = {
  shorts: ['clean', 'variety', 'info', 'neon'],
  reels: ['clean', 'mood', 'neon', 'retro'],
  youtube: ['clean', 'variety', 'info', 'mood'],
  vlog: ['clean', 'mood', 'retro', 'variety'],
}

/** 프로젝트가 고른 종류·스타일. 새로 넣는 클립·자막이 이를 따른다. */
export interface ProjectLook {
  kind: Template['id']
  style: StyleId
}

export function styleOf(look: ProjectLook | null | undefined): StyleTemplate | null {
  return look ? (STYLES[look.style] ?? null) : null
}

/** 자막 하나에 스타일을 입힌다. 사용자가 옮겨 둔 위치는 지킨다. */
export function styleSubtitle(subtitle: Subtitle, style: StyleTemplate): Subtitle {
  // 위치와 글씨체는 사용자가 이 자막에 직접 정한 것이라 스타일을 바꿔도 지킨다.
  const position = subtitle.effect?.position
  const font = subtitle.effect?.font
  return {
    ...subtitle,
    effect: { ...style.subtitleEffect, ...(position && { position }), ...(font && { font }) },
  }
}

/**
 * 클립에 스타일의 색감·전환을 입힌다. `ids` 를 주면 그 클립만 바꾼다
 * (나중에 넣은 클립만 바꾸고, 사용자가 이미 손댄 클립은 두려는 것).
 *
 * 컷 사이 페이드는 바뀌는 클립이 닿은 이음매에만, 아직 페이드가 없을 때만
 * 건다. 사용자가 정해 둔 페이드 길이를 덮어쓰지 않기 위해서다.
 */
export function styleItems(
  items: TimelineItem[],
  style: StyleTemplate,
  ids?: Set<string>,
): TimelineItem[] {
  // 음원은 화면이 없어 색감·전환을 입힐 곳이 없고, 페이드를 걸면 소리만 줄어든다.
  const touched = (item: TimelineItem) => item.type !== 'audio' && (!ids || ids.has(item.id))
  return items.map((item, index) => {
    const next: TimelineItem = touched(item)
      ? { ...item, filter: style.filter, transition: style.transition }
      : { ...item }
    if (!style.seamFade) return next
    const before = items[index - 1]
    const after = items[index + 1]
    // 이음매는 앞 클립의 끝과 뒤 클립의 시작이다. 둘 중 하나라도 바뀌면 그 이음매를 건다.
    if (before && (touched(item) || touched(before)) && !(item.fadeIn ?? 0)) {
      next.fadeIn = DEFAULT_FADE_SECONDS
    }
    if (after && (touched(item) || touched(after)) && !(item.fadeOut ?? 0)) {
      next.fadeOut = DEFAULT_FADE_SECONDS
    }
    return next
  })
}

import { create } from 'zustand'
import type {
  ExportSetting,
  MediaSource,
  RejectedFile,
  Subtitle,
  SubtitleEffect,
  Moment,
  MomentKind,
  Sticker,
  StickerKind,
  SubtitleStyle,
  TimelineItem,
  TransitionId,
} from './types'
import {
  DEFAULT_EXPORT_SETTING,
  DEFAULT_FADE_SECONDS,
  DEFAULT_SUBTITLE_SECONDS,
  DEFAULT_SUBTITLE_STYLE,
  MIN_SUBTITLE_SECONDS,
  timelineDuration,
} from './types'
import type { ProjectFile } from './file'
import { fitResolution, shortSide } from '../media/outputSize'
import { DEFAULT_STICKER_SECONDS, DEFAULT_STICKER_SIZE } from '../media/stickers'
import { TEMPLATES, matchTemplate } from './templates'
import {
  STYLES,
  STYLES_BY_KIND,
  styleItems,
  styleOf,
  styleSubtitle,
  type ProjectLook,
  type StyleId,
  type StyleTemplate,
} from './styles'
import { segmentAt, sourceTimeAt, toSegments } from './playback'
import { clipRange, normalizeSubtitle, pruneSubtitles, splitSubtitles } from './subtitles'
import {
  HISTORY_LIMIT,
  clampPlayhead,
  insertBlankAt,
  moveItem,
  removeItem,
  setBlankColor,
  setItemAudio,
  setItemDuration,
  setItemFade,
  setSeamFades,
  splitAt,
  trimItem,
  type TrimEdge,
} from './edit'

interface ProjectState {
  sources: MediaSource[]
  timeline: TimelineItem[]
  rejected: RejectedFile[]
  importing: boolean

  /** 자동 저장되는 프로젝트의 id. 첫 파일을 넣을 때 생긴다 (FR-023). */
  projectId: string | null
  projectName: string
  /** 저장공간이 부족할 때의 안내. 편집은 계속할 수 있다 (FR-026). */
  storageWarning: string | null
  /** `.cutcap` 을 열었는데 원본을 다시 골라야 하는 상태 (FR-025) */
  pendingRelink: PendingRelink | null

  selectedItemId: string | null
  selectedSubtitleId: string | null
  /** 타임라인 시작부터의 시각(초) */
  playhead: number
  playing: boolean

  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  exportSetting: ExportSetting
  /** 처음에 고른 영상 종류·스타일 (FR-049). 새로 넣는 클립·자막이 따른다 */
  look: ProjectLook | null
  /** 시작 화면에서 고르지 않고 바로 영상을 넣겠다고 한 경우 */
  startSkipped: boolean

  /** 되돌리기용 이전 상태들. 가장 최근이 배열 끝. */
  past: Snapshot[]
  future: Snapshot[]

  addImported: (sources: MediaSource[], items: TimelineItem[], rejected: RejectedFile[]) => void
  setImporting: (importing: boolean) => void
  clearRejected: () => void

  setProjectName: (name: string) => void
  setStorageWarning: (message: string | null) => void
  setPendingRelink: (value: PendingRelink | null) => void
  /** 저장해 둔 프로젝트를 통째로 되살린다. 되돌리기 기록은 새로 시작한다. */
  restore: (payload: RestorePayload) => void

  select: (id: string | null) => void
  selectSubtitle: (id: string | null) => void
  setPlayhead: (seconds: number) => void
  setPlaying: (playing: boolean) => void
  togglePlay: () => void
  nudgePlayhead: (deltaSeconds: number) => void

  split: () => void
  insertBlank: (duration?: number, color?: string) => void
  setDuration: (id: string, seconds: number) => void
  setAudio: (id: string, patch: { volume?: number; muted?: boolean }) => void
  setFade: (id: string, patch: { fadeIn?: number; fadeOut?: number }) => void
  /** 모든 컷 사이에 같은 길이의 페이드를 건다. 0 이면 뺀다. */
  setSeamFades: (seconds: number) => void
  /** 클립 하나의 화면 효과(FR-047) */
  setVisual: (id: string, patch: Pick<TimelineItem, 'filter' | 'zoom' | 'transition'>) => void
  /**
   * 모든 클립의 전환 모양을 바꾼다. 컷 사이 페이드가 없으면 전환이 보이지
   * 않으므로 기본 길이로 함께 건다. 한 번의 되돌리기로 둘 다 돌아간다.
   */
  setTransitionAll: (transition: TransitionId) => void
  /** 종류·스타일을 한 번에 고른다. 이미 넣은 클립·자막에도 입힌다 */
  chooseLook: (look: ProjectLook) => void
  /** 종류만 바꾼다(화면비·자막 모양). 스타일은 그 종류에 있으면 유지한다 */
  setLookKind: (kind: ProjectLook['kind']) => void
  /** 스타일만 바꾼다. 모든 클립·자막에 입힌다 */
  setLookStyle: (style: StyleId) => void
  /** 시작 화면으로 돌아가 다시 고른다 */
  clearLook: () => void
  skipStart: () => void
  /** 재생헤드 자리에 순간 효과를 넣는다 (FR-048) */
  addMoment: (kind: MomentKind) => void
  /** 재생헤드 자리에 스티커를 넣고 고른다 */
  addSticker: (kind: StickerKind) => void
  updateSticker: (
    clipId: string,
    id: string,
    patch: Partial<Pick<Sticker, 'x' | 'y' | 'size' | 'start' | 'end'>>,
  ) => void
  /** 순간 효과나 스티커 하나를 지운다 */
  removeOverlay: (clipId: string, id: string) => void
  setColor: (id: string, color: string) => void
  removeSelected: () => void
  moveSelected: (delta: number) => void
  trim: (id: string, edge: TrimEdge, offsetInClip: number) => void

  addSubtitle: (text?: string) => void
  updateSubtitle: (
    id: string,
    patch: Partial<Pick<Subtitle, 'text' | 'start' | 'end' | 'effect'>>,
  ) => void
  /** 한 자막의 꾸미기를 모든 자막에 똑같이. 위치는 자막마다 다르므로 옮기지 않는다. */
  applyEffectToAll: (effect: SubtitleEffect) => void
  removeSubtitle: (id: string) => void
  /** 자동 자막 결과를 넣는다. replace 면 해당 클립의 기존 자막을 먼저 지운다. */
  applyAutoSubtitles: (
    results: { clipId: string; lines: Omit<Subtitle, 'id' | 'clipId'>[] }[],
    mode: 'replace' | 'append',
  ) => void
  setSubtitleStyle: (patch: Partial<SubtitleStyle>) => void
  setExportSetting: (patch: Partial<ExportSetting>) => void

  undo: () => void
  redo: () => void
  reset: () => void
}

/** 원본을 다시 연결하는 중인 프로젝트 파일 (FR-025). */
export interface PendingRelink {
  project: ProjectFile
  /** 이미 찾은 원본. 원본 id → 파일 */
  resolved: Record<string, File>
  /** 고른 파일이 저장할 때와 달라 보인다는 등의 안내 */
  notes: string[]
}

export interface RestorePayload {
  look?: ProjectLook | null
  projectId: string
  projectName: string
  sources: MediaSource[]
  timeline: TimelineItem[]
  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  exportSetting: ExportSetting
}

/** 되돌리기 한 칸. 타임라인과 자막은 함께 움직여야 한다. */
interface Snapshot {
  timeline: TimelineItem[]
  subtitles: Subtitle[]
  /**
   * 고른 스타일. 스타일을 바꾸면 클립·자막이 함께 바뀌므로, 되돌릴 때 스타일
   * 표시도 같이 돌아가야 "예능이 골라져 있는데 화면은 정보 전달" 같은 어긋남이 없다.
   */
  look: ProjectLook | null
}

const EMPTY = {
  projectId: null as string | null,
  projectName: '새 프로젝트',
  storageWarning: null as string | null,
  pendingRelink: null as PendingRelink | null,
  sources: [] as MediaSource[],
  timeline: [] as TimelineItem[],
  subtitles: [] as Subtitle[],
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  exportSetting: DEFAULT_EXPORT_SETTING,
  look: null as ProjectLook | null,
  startSkipped: false,
  rejected: [] as RejectedFile[],
  importing: false,
  selectedItemId: null,
  selectedSubtitleId: null,
  playhead: 0,
  playing: false,
  past: [] as Snapshot[],
  future: [] as Snapshot[],
}

/**
 * 첫 영상을 넣을 때 기본 해상도를 원본에 맞춘다.
 *
 * 두 번째 영상부터는 건드리지 않는다. 사용자가 이미 설정을 봤을 수 있고,
 * 영상을 추가할 때마다 해상도가 바뀌면 이유를 알 수 없는 변화가 된다.
 */
function defaultSettingFor(
  state: { sources: MediaSource[]; exportSetting: ExportSetting },
  incoming: MediaSource[],
): ExportSetting {
  if (state.sources.some((source) => source.kind === 'video')) return state.exportSetting
  const first = incoming.find((source) => source.kind === 'video')
  if (!first) return state.exportSetting
  return {
    ...state.exportSetting,
    resolution: fitResolution(
      shortSide({ width: first.displayWidth, height: first.displayHeight }),
    ),
  }
}

export const useProject = create<ProjectState>((set, get) => {
  /**
   * 타임라인을 바꾸면서 되돌리기 기록을 남긴다.
   *
   * 타임라인은 클립 100개 이하라 통째로 복사해도 부담이 없다. 변경분만
   * 기록하는 방식은 분할·트림·순서 변경마다 되돌리기 규칙을 따로 짜야 해서
   * 틀릴 여지가 훨씬 크다.
   */
  const commit = (next: TimelineItem[], nextSubtitles?: Subtitle[]) =>
    set((state) => {
      const subtitles = pruneSubtitles(nextSubtitles ?? state.subtitles, next)
      return {
        past: [
          ...state.past,
          { timeline: state.timeline, subtitles: state.subtitles, look: state.look },
        ].slice(-HISTORY_LIMIT),
        timeline: next,
        subtitles,
        future: [],
        // 편집하는 동안 재생이 계속되면 화면과 타임라인이 어긋난다.
        playing: false,
        playhead: clampPlayhead(next, state.playhead),
        selectedItemId: next.some((item) => item.id === state.selectedItemId)
          ? state.selectedItemId
          : null,
      }
    })

  /** 재생헤드가 놓인 클립과, 그 클립 원본 기준 시각을 돌려준다. */
  const locate = () => {
    const { timeline, playhead } = get()
    const segment = segmentAt(toSegments(timeline), playhead)
    if (!segment) return null
    return { segment, sourceTime: sourceTimeAt(segment, playhead) }
  }

  /** 종류 템플릿의 화면비·해상도·자막 모양을 입힌다. 출력 설정은 되돌리기 대상이 아니다. */
  const applyKind = (kind: ProjectLook['kind']) => {
    const template = TEMPLATES.find((candidate) => candidate.id === kind)
    if (!template) return
    set((state) => ({
      exportSetting: { ...state.exportSetting, ...template.export },
      subtitleStyle: { ...state.subtitleStyle, ...template.subtitle },
    }))
  }

  /** 이미 있는 클립·자막 전체에 스타일을 입힌다. 되돌리기 한 번에 돌아간다. */
  const restyleAll = (style: StyleTemplate) => {
    const { timeline, subtitles } = get()
    if (timeline.length === 0 && subtitles.length === 0) return
    commit(
      styleItems(timeline, style),
      subtitles.map((subtitle) => styleSubtitle(subtitle, style)),
    )
  }

  /** 새로 들어온 클립에만 스타일을 입혀 붙인다. 이미 손댄 클립은 건드리지 않는다. */
  const lookItems = (state: ProjectState, items: TimelineItem[]) => {
    const style = styleOf(state.look)
    const next = [...state.timeline, ...items]
    return style ? styleItems(next, style, new Set(items.map((item) => item.id))) : next
  }

  return {
    ...EMPTY,

    addImported: (sources, items, rejected) =>
      set((state) => ({
        // 첫 파일을 넣는 순간 프로젝트가 생긴다. 빈 화면에서 만들어 두면
        // 아무것도 하지 않고 떠난 사람의 빈 프로젝트가 목록에 쌓인다.
        projectId: state.projectId ?? crypto.randomUUID(),
        projectName:
          state.projectId === null
            ? (sources[0]?.fileName.replace(/\.[^.]+$/, '') ?? state.projectName)
            : state.projectName,
        sources: [...state.sources, ...sources],
        past: [
          ...state.past,
          { timeline: state.timeline, subtitles: state.subtitles, look: state.look },
        ].slice(-HISTORY_LIMIT),
        timeline: lookItems(state, items),
        future: [],
        rejected,
        importing: false,
        // 종류를 골랐으면 그 해상도를 지킨다. 원본에 맞춰 낮추면 쇼츠 1080×1920 이
        // 720 원본 때문에 몰래 바뀌어 고른 템플릿과 어긋난다.
        exportSetting: state.look ? state.exportSetting : defaultSettingFor(state, sources),
      })),

    setImporting: (importing) => set({ importing }),
    clearRejected: () => set({ rejected: [] }),

    setProjectName: (name) => set({ projectName: name }),
    setStorageWarning: (message) => set({ storageWarning: message }),
    setPendingRelink: (value) => set({ pendingRelink: value }),

    restore: (payload) =>
      set({
        ...EMPTY,
        projectId: payload.projectId,
        projectName: payload.projectName,
        sources: payload.sources,
        timeline: payload.timeline,
        subtitles: payload.subtitles,
        subtitleStyle: payload.subtitleStyle,
        exportSetting: payload.exportSetting,
        look: payload.look ?? null,
      }),

    // 클립과 자막은 한 번에 하나만 고른다. 둘 다 골라져 있으면 Delete 가
    // 무엇을 지울지 사용자가 알 수 없다. 마지막에 고른 쪽이 대상이다.
    select: (id) =>
      set((state) => ({
        selectedItemId: id,
        selectedSubtitleId: id ? null : state.selectedSubtitleId,
      })),

    selectSubtitle: (id) =>
      set((state) => ({
        selectedSubtitleId: id,
        selectedItemId: id ? null : state.selectedItemId,
      })),

    setPlayhead: (seconds) =>
      set((state) => ({ playhead: clampPlayhead(state.timeline, seconds) })),

    setPlaying: (playing) => set({ playing }),

    togglePlay: () =>
      set((state) => {
        if (state.timeline.length === 0) return state
        // 끝에서 다시 누르면 처음부터 재생한다. 그러지 않으면 아무 반응이
        // 없는 것처럼 보인다.
        const atEnd = state.playhead >= timelineDuration(state.timeline) - 0.05
        return { playing: !state.playing, playhead: !state.playing && atEnd ? 0 : state.playhead }
      }),

    nudgePlayhead: (deltaSeconds) =>
      set((state) => ({
        playhead: clampPlayhead(state.timeline, state.playhead + deltaSeconds),
      })),

    split: () => {
      const { timeline, subtitles, playhead } = get()
      const result = splitAt(timeline, playhead)
      if (!result) return
      commit(
        result.items,
        splitSubtitles(subtitles, result.originalId, result.leftId, result.rightId, result.cut),
      )
    },

    insertBlank: (duration, color) => {
      const { timeline, playhead } = get()
      commit(insertBlankAt(timeline, playhead, duration, color))
    },

    setDuration: (id, seconds) => {
      const next = setItemDuration(get().timeline, id, seconds)
      if (next) commit(next)
    },

    setAudio: (id, patch) => {
      const next = setItemAudio(get().timeline, id, patch)
      if (next) commit(next)
    },

    setFade: (id, patch) => {
      const next = setItemFade(get().timeline, id, patch)
      if (next) commit(next)
    },

    setSeamFades: (seconds) => {
      const { timeline } = get()
      if (timeline.length < 2) return
      commit(setSeamFades(timeline, seconds))
    },

    setVisual: (id, patch) => {
      const { timeline } = get()
      if (!timeline.some((item) => item.id === id)) return
      commit(timeline.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    },

    setTransitionAll: (transition) => {
      const { timeline } = get()
      const seamless = timeline.every(
        (item, index) =>
          (index === 0 || !(item.fadeIn ?? 0)) &&
          (index === timeline.length - 1 || !(item.fadeOut ?? 0)),
      )
      const faded =
        seamless && timeline.length > 1 ? setSeamFades(timeline, DEFAULT_FADE_SECONDS) : timeline
      commit(faded.map((item) => ({ ...item, transition })))
    },

    addMoment: (kind) => {
      const found = locate()
      if (!found || found.segment.item.type === 'audio') return
      const { segment, sourceTime } = found
      const moment: Moment = { id: crypto.randomUUID(), kind, time: sourceTime }
      commit(
        get().timeline.map((item) =>
          item.id === segment.item.id
            ? { ...item, moments: [...(item.moments ?? []), moment] }
            : item,
        ),
      )
    },

    addSticker: (kind) => {
      const found = locate()
      if (!found || found.segment.item.type === 'audio') return
      const { segment, sourceTime } = found
      const range = clipRange(segment.item)
      const end = Math.min(sourceTime + DEFAULT_STICKER_SECONDS, range.end)
      if (end - sourceTime < MIN_SUBTITLE_SECONDS) return
      const sticker: Sticker = {
        id: crypto.randomUUID(),
        kind,
        start: sourceTime,
        end,
        // 자막(아래 가운데)과 겹치지 않게 오른쪽 위에 둔다.
        x: 0.75,
        y: 0.3,
        size: DEFAULT_STICKER_SIZE,
      }
      commit(
        get().timeline.map((item) =>
          item.id === segment.item.id
            ? { ...item, stickers: [...(item.stickers ?? []), sticker] }
            : item,
        ),
      )
    },

    updateSticker: (clipId, id, patch) => {
      commit(
        get().timeline.map((item) =>
          item.id === clipId
            ? {
                ...item,
                stickers: (item.stickers ?? []).map((sticker) =>
                  sticker.id === id ? { ...sticker, ...patch } : sticker,
                ),
              }
            : item,
        ),
      )
    },

    removeOverlay: (clipId, id) => {
      commit(
        get().timeline.map((item) =>
          item.id === clipId
            ? {
                ...item,
                moments: (item.moments ?? []).filter((moment) => moment.id !== id),
                stickers: (item.stickers ?? []).filter((sticker) => sticker.id !== id),
              }
            : item,
        ),
      )
    },

    chooseLook: (look) => {
      applyKind(look.kind)
      // 먼저 입히고 나서 고른 것을 적는다. 되돌리기 기록에 이전 스타일이 남아야 한다.
      restyleAll(STYLES[look.style])
      set({ look, startSkipped: false })
    },

    setLookKind: (kind) => {
      applyKind(kind)
      const current = get().look
      // 새 종류에 없는 스타일이면 깔끔으로 둔다. 효과는 이미 입혀 둔 그대로 남는다.
      const style =
        current && STYLES_BY_KIND[kind].includes(current.style) ? current.style : 'clean'
      set({ look: { kind, style } })
    },

    setLookStyle: (style) => {
      const kind = get().look?.kind ?? matchTemplate(get().exportSetting, get().subtitleStyle)?.id
      if (!kind) return
      restyleAll(STYLES[style])
      set({ look: { kind, style } })
    },

    clearLook: () => set({ look: null, startSkipped: false }),
    skipStart: () => set({ startSkipped: true }),

    setColor: (id, color) => {
      const next = setBlankColor(get().timeline, id, color)
      if (next) commit(next)
    },

    removeSelected: () => {
      const { timeline, selectedItemId, selectedSubtitleId } = get()
      if (selectedSubtitleId) {
        get().removeSubtitle(selectedSubtitleId)
        return
      }
      if (!selectedItemId) return
      commit(removeItem(timeline, selectedItemId))
    },

    moveSelected: (delta) => {
      const { timeline, selectedItemId } = get()
      if (!selectedItemId) return
      const next = moveItem(timeline, selectedItemId, delta)
      if (next) commit(next)
    },

    trim: (id, edge, offsetInClip) => {
      const { timeline, sources } = get()
      const next = trimItem(timeline, sources, id, edge, offsetInClip)
      if (next) commit(next)
    },

    addSubtitle: (text = '') => {
      const found = locate()
      if (!found) return
      const { segment, sourceTime } = found
      const range = clipRange(segment.item)
      const start = Math.min(sourceTime, range.end - MIN_SUBTITLE_SECONDS)
      const end = Math.min(start + DEFAULT_SUBTITLE_SECONDS, range.end)
      if (end - start < MIN_SUBTITLE_SECONDS) return

      const base: Subtitle = {
        id: crypto.randomUUID(),
        clipId: segment.item.id,
        start,
        end,
        text,
      }
      const style = styleOf(get().look)
      const subtitle = style ? styleSubtitle(base, style) : base
      commit(get().timeline, [...get().subtitles, subtitle])
      get().selectSubtitle(subtitle.id)
    },

    updateSubtitle: (id, patch) => {
      const { timeline, subtitles } = get()
      const index = subtitles.findIndex((subtitle) => subtitle.id === id)
      if (index === -1) return

      const item = timeline.find((candidate) => candidate.id === subtitles[index].clipId)
      if (!item) return

      const next = [...subtitles]
      const merged = { ...subtitles[index], ...patch }
      if (patch.text !== undefined && patch.text !== subtitles[index].text) delete merged.words
      next[index] = normalizeSubtitle(merged, item)
      commit(timeline, next)
    },

    applyEffectToAll: (effect) => {
      const { timeline, subtitles } = get()
      const { position: _ignored, ...shared } = effect
      commit(
        timeline,
        subtitles.map((subtitle) => ({
          ...subtitle,
          effect: {
            ...shared,
            ...(subtitle.effect?.position && { position: subtitle.effect.position }),
          },
        })),
      )
    },

    applyAutoSubtitles: (results, mode) => {
      const { timeline, subtitles } = get()
      const items = new Map(timeline.map((item) => [item.id, item]))
      const touched = new Set(results.map((result) => result.clipId))
      const kept =
        mode === 'replace'
          ? subtitles.filter((subtitle) => !touched.has(subtitle.clipId))
          : subtitles
      const created: Subtitle[] = []
      const style = styleOf(get().look)
      for (const { clipId, lines } of results) {
        const item = items.get(clipId)
        // 인식하는 동안 클립이 지워졌으면 결과도 버린다.
        if (!item) continue
        for (const line of lines) {
          const made = normalizeSubtitle({ ...line, id: crypto.randomUUID(), clipId }, item)
          created.push(style ? styleSubtitle(made, style) : made)
        }
      }
      // 클립 여러 개를 한 번에 처리해도 되돌리기 한 번으로 통째로 돌아가야 한다.
      commit(timeline, [...kept, ...created])
    },

    removeSubtitle: (id) => {
      if (get().selectedSubtitleId === id) set({ selectedSubtitleId: null })
      commit(
        get().timeline,
        get().subtitles.filter((subtitle) => subtitle.id !== id),
      )
    },

    setSubtitleStyle: (patch) =>
      set((state) => ({ subtitleStyle: { ...state.subtitleStyle, ...patch } })),

    // 출력 설정은 편집 내용이 아니므로 되돌리기 기록에 넣지 않는다.
    setExportSetting: (patch) =>
      set((state) => ({ exportSetting: { ...state.exportSetting, ...patch } })),

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1)
        if (!previous) return state
        return {
          past: state.past.slice(0, -1),
          timeline: previous.timeline,
          subtitles: previous.subtitles,
          look: previous.look,
          future: [
            { timeline: state.timeline, subtitles: state.subtitles, look: state.look },
            ...state.future,
          ].slice(0, HISTORY_LIMIT),
          playing: false,
          playhead: clampPlayhead(previous.timeline, state.playhead),
          selectedItemId: previous.timeline.some((item) => item.id === state.selectedItemId)
            ? state.selectedItemId
            : null,
        }
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future
        if (!next) return state
        return {
          past: [
            ...state.past,
            { timeline: state.timeline, subtitles: state.subtitles, look: state.look },
          ].slice(-HISTORY_LIMIT),
          timeline: next.timeline,
          subtitles: next.subtitles,
          look: next.look,
          future: rest,
          playing: false,
          playhead: clampPlayhead(next.timeline, state.playhead),
          selectedItemId: next.timeline.some((item) => item.id === state.selectedItemId)
            ? state.selectedItemId
            : null,
        }
      }),

    reset: () => set(EMPTY),
  }
})

/** 타임라인 항목이 참조하는 원본을 찾는다. */
export function findSource(sources: MediaSource[], sourceId: string | null): MediaSource | null {
  if (!sourceId) return null
  return sources.find((source) => source.id === sourceId) ?? null
}

export function useTimelineDuration(): number {
  return useProject((state) => timelineDuration(state.timeline))
}

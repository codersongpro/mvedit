import { create } from 'zustand'
import type {
  ExportSetting,
  MediaSource,
  RejectedFile,
  Subtitle,
  SubtitleStyle,
  TimelineItem,
} from './types'
import {
  DEFAULT_EXPORT_SETTING,
  DEFAULT_SUBTITLE_SECONDS,
  DEFAULT_SUBTITLE_STYLE,
  MIN_SUBTITLE_SECONDS,
  timelineDuration,
} from './types'
import { fitResolution } from '../media/outputSize'
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
  splitAt,
  trimItem,
  type TrimEdge,
} from './edit'

interface ProjectState {
  sources: MediaSource[]
  timeline: TimelineItem[]
  rejected: RejectedFile[]
  importing: boolean

  selectedItemId: string | null
  selectedSubtitleId: string | null
  /** 타임라인 시작부터의 시각(초) */
  playhead: number
  playing: boolean

  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  exportSetting: ExportSetting

  /** 되돌리기용 이전 상태들. 가장 최근이 배열 끝. */
  past: Snapshot[]
  future: Snapshot[]

  addImported: (sources: MediaSource[], items: TimelineItem[], rejected: RejectedFile[]) => void
  setImporting: (importing: boolean) => void
  clearRejected: () => void

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
  setColor: (id: string, color: string) => void
  removeSelected: () => void
  moveSelected: (delta: number) => void
  trim: (id: string, edge: TrimEdge, offsetInClip: number) => void

  addSubtitle: (text?: string) => void
  updateSubtitle: (id: string, patch: Partial<Pick<Subtitle, 'text' | 'start' | 'end'>>) => void
  removeSubtitle: (id: string) => void
  setSubtitleStyle: (patch: Partial<SubtitleStyle>) => void
  setExportSetting: (patch: Partial<ExportSetting>) => void

  undo: () => void
  redo: () => void
  reset: () => void
}

/** 되돌리기 한 칸. 타임라인과 자막은 함께 움직여야 한다. */
interface Snapshot {
  timeline: TimelineItem[]
  subtitles: Subtitle[]
}

const EMPTY = {
  sources: [] as MediaSource[],
  timeline: [] as TimelineItem[],
  subtitles: [] as Subtitle[],
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  exportSetting: DEFAULT_EXPORT_SETTING,
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
    resolution: fitResolution(first.displayHeight),
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
        past: [...state.past, { timeline: state.timeline, subtitles: state.subtitles }].slice(
          -HISTORY_LIMIT,
        ),
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

  return {
    ...EMPTY,

    addImported: (sources, items, rejected) =>
      set((state) => ({
        sources: [...state.sources, ...sources],
        past: [...state.past, { timeline: state.timeline, subtitles: state.subtitles }].slice(
          -HISTORY_LIMIT,
        ),
        timeline: [...state.timeline, ...items],
        future: [],
        rejected,
        importing: false,
        exportSetting: defaultSettingFor(state, sources),
      })),

    setImporting: (importing) => set({ importing }),
    clearRejected: () => set({ rejected: [] }),

    select: (id) => set({ selectedItemId: id }),

    selectSubtitle: (id) => set({ selectedSubtitleId: id }),

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

    setColor: (id, color) => {
      const next = setBlankColor(get().timeline, id, color)
      if (next) commit(next)
    },

    removeSelected: () => {
      const { timeline, selectedItemId } = get()
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

      const subtitle: Subtitle = {
        id: crypto.randomUUID(),
        clipId: segment.item.id,
        start,
        end,
        text,
      }
      commit(get().timeline, [...get().subtitles, subtitle])
      set({ selectedSubtitleId: subtitle.id })
    },

    updateSubtitle: (id, patch) => {
      const { timeline, subtitles } = get()
      const index = subtitles.findIndex((subtitle) => subtitle.id === id)
      if (index === -1) return

      const item = timeline.find((candidate) => candidate.id === subtitles[index].clipId)
      if (!item) return

      const next = [...subtitles]
      next[index] = normalizeSubtitle({ ...subtitles[index], ...patch }, item)
      commit(timeline, next)
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
          future: [
            { timeline: state.timeline, subtitles: state.subtitles },
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
          past: [...state.past, { timeline: state.timeline, subtitles: state.subtitles }].slice(
            -HISTORY_LIMIT,
          ),
          timeline: next.timeline,
          subtitles: next.subtitles,
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

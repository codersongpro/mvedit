import { create } from 'zustand'
import type { MediaSource, RejectedFile, TimelineItem } from './types'
import { timelineDuration } from './types'
import {
  HISTORY_LIMIT,
  clampPlayhead,
  moveItem,
  removeItem,
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
  /** 타임라인 시작부터의 시각(초) */
  playhead: number

  /** 되돌리기용 이전 상태들. 가장 최근이 배열 끝. */
  past: TimelineItem[][]
  future: TimelineItem[][]

  addImported: (sources: MediaSource[], items: TimelineItem[], rejected: RejectedFile[]) => void
  setImporting: (importing: boolean) => void
  clearRejected: () => void

  select: (id: string | null) => void
  setPlayhead: (seconds: number) => void
  nudgePlayhead: (deltaSeconds: number) => void

  split: () => void
  removeSelected: () => void
  moveSelected: (delta: number) => void
  trim: (id: string, edge: TrimEdge, offsetInClip: number) => void

  undo: () => void
  redo: () => void
  reset: () => void
}

const EMPTY = {
  sources: [] as MediaSource[],
  timeline: [] as TimelineItem[],
  rejected: [] as RejectedFile[],
  importing: false,
  selectedItemId: null,
  playhead: 0,
  past: [] as TimelineItem[][],
  future: [] as TimelineItem[][],
}

export const useProject = create<ProjectState>((set, get) => {
  /**
   * 타임라인을 바꾸면서 되돌리기 기록을 남긴다.
   *
   * 타임라인은 클립 100개 이하라 통째로 복사해도 부담이 없다. 변경분만
   * 기록하는 방식은 분할·트림·순서 변경마다 되돌리기 규칙을 따로 짜야 해서
   * 틀릴 여지가 훨씬 크다.
   */
  const commit = (next: TimelineItem[]) =>
    set((state) => ({
      past: [...state.past, state.timeline].slice(-HISTORY_LIMIT),
      timeline: next,
      future: [],
      playhead: clampPlayhead(next, state.playhead),
      selectedItemId: next.some((item) => item.id === state.selectedItemId)
        ? state.selectedItemId
        : null,
    }))

  return {
    ...EMPTY,

    addImported: (sources, items, rejected) =>
      set((state) => ({
        sources: [...state.sources, ...sources],
        past: [...state.past, state.timeline].slice(-HISTORY_LIMIT),
        timeline: [...state.timeline, ...items],
        future: [],
        rejected,
        importing: false,
      })),

    setImporting: (importing) => set({ importing }),
    clearRejected: () => set({ rejected: [] }),

    select: (id) => set({ selectedItemId: id }),

    setPlayhead: (seconds) =>
      set((state) => ({ playhead: clampPlayhead(state.timeline, seconds) })),

    nudgePlayhead: (deltaSeconds) =>
      set((state) => ({
        playhead: clampPlayhead(state.timeline, state.playhead + deltaSeconds),
      })),

    split: () => {
      const { timeline, playhead } = get()
      const next = splitAt(timeline, playhead)
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

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1)
        if (!previous) return state
        return {
          past: state.past.slice(0, -1),
          timeline: previous,
          future: [state.timeline, ...state.future].slice(0, HISTORY_LIMIT),
          playhead: clampPlayhead(previous, state.playhead),
          selectedItemId: previous.some((item) => item.id === state.selectedItemId)
            ? state.selectedItemId
            : null,
        }
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future
        if (!next) return state
        return {
          past: [...state.past, state.timeline].slice(-HISTORY_LIMIT),
          timeline: next,
          future: rest,
          playhead: clampPlayhead(next, state.playhead),
          selectedItemId: next.some((item) => item.id === state.selectedItemId)
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

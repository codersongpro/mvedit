import { create } from 'zustand'
import type { MediaSource, RejectedFile, TimelineItem } from './types'
import { timelineDuration } from './types'

interface ProjectState {
  sources: MediaSource[]
  timeline: TimelineItem[]
  /** 직전 불러오기에서 실패한 파일들. 다음 불러오기 때 비워진다. */
  rejected: RejectedFile[]
  importing: boolean

  addImported: (sources: MediaSource[], items: TimelineItem[], rejected: RejectedFile[]) => void
  setImporting: (importing: boolean) => void
  clearRejected: () => void
  reset: () => void
}

export const useProject = create<ProjectState>((set) => ({
  sources: [],
  timeline: [],
  rejected: [],
  importing: false,

  addImported: (sources, items, rejected) =>
    set((state) => ({
      sources: [...state.sources, ...sources],
      // 고른 순서대로 타임라인 뒤에 이어 붙인다 (AC-002).
      timeline: [...state.timeline, ...items],
      rejected,
      importing: false,
    })),

  setImporting: (importing) => set({ importing }),
  clearRejected: () => set({ rejected: [] }),
  reset: () => set({ sources: [], timeline: [], rejected: [], importing: false }),
}))

/** 타임라인 항목이 참조하는 원본을 찾는다. */
export function findSource(sources: MediaSource[], sourceId: string | null): MediaSource | null {
  if (!sourceId) return null
  return sources.find((source) => source.id === sourceId) ?? null
}

export function useTimelineDuration(): number {
  return useProject((state) => timelineDuration(state.timeline))
}

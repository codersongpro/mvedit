/**
 * 자동 저장과 복원 (FR-023, FR-026).
 *
 * 편집 내용은 조작이 멈추면 곧바로 저장하고, 원본 파일은 불러올 때 한 번만
 * 복사한다. 원본까지 매번 다시 쓰면 클립 하나 옮길 때마다 수백 MB 를 쓰게 된다.
 */
import { useEffect } from 'react'
import { useProject } from './store'
import type { MediaSource } from './types'
import {
  estimateStorage,
  hasRoomFor,
  loadProject,
  saveMedia,
  saveProject,
  type StoredProject,
} from './storage'
import { formatBytes } from '../format'

/** 조작이 멈춘 뒤 이만큼 기다렸다 저장한다. 드래그 중에 매번 쓰지 않으려는 것. */
const SAVE_DEBOUNCE_MS = 600

function snapshotOf(state: ReturnType<typeof useProject.getState>): StoredProject | null {
  if (!state.projectId) return null
  return {
    id: state.projectId,
    name: state.projectName,
    updatedAt: Date.now(),
    // File 은 media 저장소에 따로 있다. 여기 담으면 편집할 때마다 원본이 복사된다.
    sources: state.sources.map(({ file: _file, ...rest }) => rest),
    timeline: state.timeline,
    subtitles: state.subtitles,
    subtitleStyle: state.subtitleStyle,
    exportSetting: state.exportSetting,
  }
}

/**
 * 편집 내용이 바뀌면 자동 저장한다.
 *
 * 재생헤드·선택 같은 화면 상태는 저장 대상이 아니다. 재생만 해도 저장이
 * 돌면 초당 수십 번 쓰게 된다.
 */
export function useAutosave(): void {
  useEffect(() => {
    let timer: number | undefined
    let saving = false

    const save = async () => {
      if (saving) return
      const snapshot = snapshotOf(useProject.getState())
      if (!snapshot) return
      saving = true
      try {
        await saveProject(snapshot)
      } catch (error) {
        console.warn('자동 저장 실패', error)
        useProject
          .getState()
          .setStorageWarning(
            '편집 내용을 저장하지 못했습니다. 저장공간이 부족할 수 있으니 지금 영상을 내보내 두세요.',
          )
      } finally {
        saving = false
      }
    }

    const unsubscribe = useProject.subscribe((state, previous) => {
      if (
        state.projectId === previous.projectId &&
        state.projectName === previous.projectName &&
        state.timeline === previous.timeline &&
        state.subtitles === previous.subtitles &&
        state.subtitleStyle === previous.subtitleStyle &&
        state.exportSetting === previous.exportSetting &&
        state.sources === previous.sources
      ) {
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
    })

    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])
}

/**
 * 불러온 원본을 저장소에 복사한다 (FR-026, AC-030).
 *
 * 공간이 모자라면 복사를 건너뛰고 알린다. 여기서 멈춰 버리면 지금 하던 편집도
 * 못 하게 되므로, 편집과 내보내기는 그대로 되도록 둔다.
 */
export async function persistSources(projectId: string, sources: MediaSource[]): Promise<void> {
  const total = sources.reduce((sum, source) => sum + source.file.size, 0)
  const room = await estimateStorage()

  if (!hasRoomFor(total, room)) {
    useProject
      .getState()
      .setStorageWarning(
        `저장공간이 부족해 이 영상(${formatBytes(total)})을 자동 저장하지 않았습니다. ` +
          '지금 편집과 내보내기는 그대로 할 수 있지만, 창을 닫으면 이어서 작업할 수 없습니다.',
      )
    return
  }

  for (const source of sources) {
    try {
      await saveMedia(projectId, source.id, source.file)
    } catch (error) {
      console.warn('원본 저장 실패', error)
      useProject
        .getState()
        .setStorageWarning(
          '원본을 저장공간에 복사하지 못했습니다. 창을 닫으면 이 영상은 다시 불러와야 합니다.',
        )
      return
    }
  }
}

/**
 * 저장된 프로젝트를 화면으로 되살린다 (AC-026).
 *
 * 원본을 찾지 못한 클립은 빼고 연다. 그대로 두면 재생도 내보내기도 도중에
 * 실패한다. 어떤 파일이 없는지는 알려 준다.
 */
export async function openProject(id: string): Promise<{ missing: string[] } | null> {
  const restored = await loadProject(id)
  if (!restored) return null

  const { project, files, missing } = restored
  const sources: MediaSource[] = project.sources
    .filter((source) => files.has(source.id))
    .map((source) => ({ ...source, file: files.get(source.id) as File }))

  const usable = new Set(sources.map((source) => source.id))
  const timeline = project.timeline.filter(
    (item) => item.sourceId === null || usable.has(item.sourceId),
  )
  const keptItems = new Set(timeline.map((item) => item.id))

  useProject.getState().restore({
    projectId: project.id,
    projectName: project.name,
    sources,
    timeline,
    subtitles: project.subtitles.filter((subtitle) => keptItems.has(subtitle.clipId)),
    subtitleStyle: project.subtitleStyle,
    exportSetting: project.exportSetting,
  })

  if (missing.length > 0) {
    useProject
      .getState()
      .setStorageWarning(
        `원본을 찾지 못해 일부 클립을 빼고 열었습니다: ${missing.join(', ')}. ` +
          '해당 파일을 다시 추가해 주세요.',
      )
  }
  return { missing }
}

import { useCallback, useEffect, useState } from 'react'
import { useProject } from '../lib/project/store'
import { openProject } from '../lib/project/persist'
import {
  deleteProject,
  listProjects,
  renameProject,
  type ProjectSummary,
} from '../lib/project/storage'
import { DeleteIcon } from './icons'
import { btn, sectionTitle } from './m3'

/** "3분 전"처럼 읽기 쉬운 시각. 어제 작업인지 방금인지만 알면 충분하다. */
function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '방금 전'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.round(hours / 24)}일 전`
}

/**
 * 저장된 프로젝트 목록 (FR-023, FR-031).
 *
 * 편집 중에는 보이지 않는다. 지금 작업과 예전 작업이 한 화면에 섞이면
 * 어느 쪽을 보고 있는지 헷갈린다.
 */
export function ProjectList() {
  const timeline = useProject((state) => state.timeline)
  const currentId = useProject((state) => state.projectId)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  useEffect(refresh, [refresh])

  if (timeline.length > 0 || projects.length === 0) return null

  const open = async (id: string) => {
    setBusy(true)
    try {
      await openProject(id)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await deleteProject(id)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const commitRename = async (id: string) => {
    const name = draftName.trim()
    setRenamingId(null)
    if (!name) return
    await renameProject(id, name)
    if (id === currentId) useProject.getState().setProjectName(name)
    refresh()
  }

  return (
    <section data-testid="project-list" className="flex flex-col gap-2">
      <h2 className={sectionTitle}>이어서 작업하기</h2>
      <ul className="flex flex-col gap-0.5 overflow-hidden rounded-m3-lg">
        {projects.map((project) => (
          <li
            key={project.id}
            data-testid="project-item"
            data-project-name={project.name}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface-container px-4 py-3"
          >
            {project.thumbnailUrl ? (
              <img
                src={project.thumbnailUrl}
                alt=""
                className="h-10 w-16 shrink-0 rounded-m3-sm object-cover"
              />
            ) : (
              <div className="h-10 w-16 shrink-0 rounded-m3-sm bg-surface-container-highest" />
            )}

            <div className="min-w-[140px] flex-1">
              {renamingId === project.id ? (
                <input
                  autoFocus
                  data-testid="project-rename-input"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => void commitRename(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitRename(project.id)
                    if (event.key === 'Escape') setRenamingId(null)
                  }}
                  className="h-10 w-full rounded-m3-xs border-2 border-primary bg-transparent px-3 m3-body-large text-on-surface outline-none"
                />
              ) : (
                <p className="truncate m3-body-large text-on-surface">{project.name}</p>
              )}
              <p className="m3-body-small text-on-surface-variant">
                클립 {project.clipCount}개 · {timeAgo(project.updatedAt)}
              </p>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid="project-open"
                disabled={busy}
                onClick={() => void open(project.id)}
                className={`${btn.filled} px-4`}
              >
                열기
              </button>
              <button
                type="button"
                data-testid="project-rename"
                disabled={busy}
                onClick={() => {
                  setRenamingId(project.id)
                  setDraftName(project.name)
                }}
                className={btn.text}
              >
                이름 바꾸기
              </button>
              <button
                type="button"
                data-testid="project-delete"
                disabled={busy}
                onClick={() => void remove(project.id)}
                aria-label="지우기"
                title="지우기"
                className={`${btn.icon} h-10 w-10`}
              >
                <DeleteIcon size={20} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

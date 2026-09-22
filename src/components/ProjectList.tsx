import { useCallback, useEffect, useState } from 'react'
import { useProject } from '../lib/project/store'
import { openProject } from '../lib/project/persist'
import {
  deleteProject,
  listProjects,
  renameProject,
  type ProjectSummary,
} from '../lib/project/storage'

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
      <h2 className="text-sm font-semibold text-slate-300">이어서 작업하기</h2>
      <ul className="flex flex-col gap-2">
        {projects.map((project) => (
          <li
            key={project.id}
            data-testid="project-item"
            data-project-name={project.name}
            className="flex items-center gap-3 rounded-xl bg-slate-900/60 p-3"
          >
            {project.thumbnailUrl ? (
              <img
                src={project.thumbnailUrl}
                alt=""
                className="h-10 w-16 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="h-10 w-16 shrink-0 rounded-md bg-slate-800" />
            )}

            <div className="min-w-0 flex-1">
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
                  className="h-9 w-full rounded-lg bg-slate-800 px-2 text-sm text-slate-100"
                />
              ) : (
                <p className="truncate text-sm font-medium text-slate-100">{project.name}</p>
              )}
              <p className="text-[11px] text-slate-500">
                클립 {project.clipCount}개 · {timeAgo(project.updatedAt)}
              </p>
            </div>

            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                data-testid="project-open"
                disabled={busy}
                onClick={() => void open(project.id)}
                className="min-h-9 rounded-lg bg-sky-500 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"
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
                className="min-h-9 rounded-lg bg-slate-800 px-3 text-xs text-slate-300 disabled:opacity-50"
              >
                이름 바꾸기
              </button>
              <button
                type="button"
                data-testid="project-delete"
                disabled={busy}
                onClick={() => void remove(project.id)}
                className="min-h-9 rounded-lg bg-slate-800 px-3 text-xs text-rose-300 disabled:opacity-50"
              >
                지우기
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

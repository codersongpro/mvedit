import { useEffect, useRef, useState } from 'react'
import { useProject } from '../lib/project/store'
import { matchFiles } from '../lib/project/file'
import { findStoredMedia } from '../lib/project/storage'
import { persistSources } from '../lib/project/persist'
import type { MediaSource } from '../lib/project/types'
import { formatBytes, formatClock } from '../lib/format'

/** 고른 파일이 저장할 때와 얼마나 달라도 넘어갈지. 인코딩 차이 정도는 봐준다. */
const DURATION_TOLERANCE = 0.5

/**
 * `.cutcap` 을 열 때 원본을 다시 연결한다 (FR-025, AC-029).
 *
 * 프로젝트 파일에는 영상이 들어 있지 않으므로, 어떤 파일이 필요한지
 * 이름과 크기로 알려 주고 고르게 한다. 같은 기기에서 만든 파일이라면
 * 저장소에 원본이 남아 있어 고를 필요조차 없다.
 */
export function RelinkPanel() {
  const pending = useProject((state) => state.pendingRelink)
  const setPending = useProject((state) => state.setPendingRelink)
  const restore = useProject((state) => state.restore)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  // 같은 기기에서 만든 파일이면 저장된 원본을 먼저 찾아 붙인다.
  const projectKey = pending?.project.savedAt
  useEffect(() => {
    const current = useProject.getState().pendingRelink
    if (!current) return
    const unresolved = current.project.sources.filter((source) => !current.resolved[source.id])
    if (unresolved.length === 0) return

    let cancelled = false
    findStoredMedia(unresolved.map((source) => source.id))
      .then((found) => {
        if (cancelled || found.size === 0) return
        const latest = useProject.getState().pendingRelink
        if (!latest) return
        setPending({
          ...latest,
          resolved: { ...latest.resolved, ...Object.fromEntries(found) },
          notes: latest.notes,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectKey, setPending])

  if (!pending) return null

  const { project, resolved, notes } = pending
  const missing = project.sources.filter((source) => !resolved[source.id])

  const addFiles = (files: File[]) => {
    const { matched } = matchFiles(missing, files)
    if (matched.size === 0) {
      setPending({
        ...pending,
        notes: ['고른 파일이 필요한 원본과 맞지 않습니다. 파일 이름과 크기를 확인해 주세요.'],
      })
      return
    }

    const nextNotes: string[] = []
    for (const [sourceId, file] of matched) {
      const source = project.sources.find((candidate) => candidate.id === sourceId)
      if (source && source.fileSize !== file.size) {
        nextNotes.push(`${file.name}은(는) 저장할 때와 크기가 다릅니다. 다른 파일일 수 있습니다.`)
      }
    }

    setPending({
      ...pending,
      resolved: { ...resolved, ...Object.fromEntries(matched) },
      notes: nextNotes,
    })
  }

  /** 고른 파일들을 실제 원본으로 읽어 들여 타임라인을 되살린다 (AC-028). */
  const open = async (skipMissing: boolean) => {
    setBusy(true)
    try {
      const { importFiles } = await import('../lib/media/import')
      const sources: MediaSource[] = []
      const warnings: string[] = []

      for (const stored of project.sources) {
        const file = resolved[stored.id]
        if (!file) continue

        // 저장된 정보 대신 실제 파일을 다시 읽는다. 썸네일도 새로 만들고,
        // 엉뚱한 파일을 골랐는지도 이때 드러난다.
        const outcome = await importFiles([file])
        const probed = outcome.sources[0]
        if (!probed) {
          warnings.push(`${file.name}을(를) 읽을 수 없어 뺐습니다.`)
          continue
        }
        if (
          stored.durationSeconds !== null &&
          probed.durationSeconds !== null &&
          Math.abs(stored.durationSeconds - probed.durationSeconds) > DURATION_TOLERANCE
        ) {
          warnings.push(
            `${file.name}의 길이가 저장할 때와 다릅니다(` +
              `${formatClock(stored.durationSeconds)} → ${formatClock(probed.durationSeconds)}). ` +
              '자른 위치가 어긋날 수 있습니다.',
          )
        }
        // 타임라인은 저장된 원본 id 를 가리킨다. 새로 만들어진 id 로 바꾸면
        // 모든 클립이 원본을 잃는다.
        sources.push({ ...probed, id: stored.id })
      }

      const usable = new Set(sources.map((source) => source.id))
      const timeline = project.timeline.filter(
        (item) => item.sourceId === null || usable.has(item.sourceId),
      )
      const keptItems = new Set(timeline.map((item) => item.id))
      const dropped = project.timeline.length - timeline.length
      if (skipMissing && dropped > 0) warnings.push(`원본이 없는 클립 ${dropped}개를 뺐습니다.`)

      const projectId = crypto.randomUUID()
      restore({
        projectId,
        projectName: project.name,
        sources,
        timeline,
        subtitles: project.subtitles.filter((subtitle) => keptItems.has(subtitle.clipId)),
        subtitleStyle: project.subtitleStyle,
        exportSetting: project.exportSetting,
      })
      if (warnings.length > 0) useProject.getState().setStorageWarning(warnings.join(' '))

      // 불러온 원본을 이 기기에도 저장해 둔다. 다음부터는 자동 저장이 이어진다.
      void persistSources(projectId, sources)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      data-testid="relink-panel"
      className="flex flex-col gap-3 rounded-xl bg-slate-900/60 p-4 ring-1 ring-sky-500/20"
    >
      <div>
        <h2 className="text-sm font-semibold text-slate-100">
          프로젝트 파일 열기 — {project.name}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          프로젝트 파일에는 영상이 들어 있지 않습니다. 아래 원본 파일을 골라 주세요.
        </p>
      </div>

      <ul className="flex flex-col gap-1">
        {project.sources.map((source) => (
          <li
            key={source.id}
            data-testid="relink-source"
            data-resolved={resolved[source.id] ? 'yes' : 'no'}
            className="flex items-center gap-2 text-xs"
          >
            <span className={resolved[source.id] ? 'text-emerald-400' : 'text-slate-600'}>
              {resolved[source.id] ? '●' : '○'}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-200">{source.fileName}</span>
            <span className="shrink-0 text-slate-500 tabular-nums">
              {formatBytes(source.fileSize)}
              {source.durationSeconds !== null && ` · ${formatClock(source.durationSeconds)}`}
            </span>
          </li>
        ))}
      </ul>

      {notes.length > 0 && (
        <p data-testid="relink-note" className="text-xs leading-relaxed text-amber-300/90">
          {notes.join(' ')}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        className="sr-only"
        data-testid="relink-input"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />

      <div className="flex flex-wrap gap-2">
        {missing.length > 0 && (
          <button
            type="button"
            data-testid="relink-pick"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="min-h-10 rounded-lg bg-sky-500 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
          >
            원본 파일 고르기 ({missing.length}개 필요)
          </button>
        )}
        {missing.length === 0 && (
          <button
            type="button"
            data-testid="relink-open"
            disabled={busy}
            onClick={() => void open(false)}
            className="min-h-10 rounded-lg bg-emerald-500 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
          >
            불러오기
          </button>
        )}
        {missing.length > 0 && missing.length < project.sources.length && (
          <button
            type="button"
            data-testid="relink-open-partial"
            disabled={busy}
            onClick={() => void open(true)}
            className="min-h-10 rounded-lg bg-slate-800 px-4 text-xs text-slate-300 disabled:opacity-50"
          >
            없는 클립 빼고 열기
          </button>
        )}
        <button
          type="button"
          data-testid="relink-cancel"
          disabled={busy}
          onClick={() => setPending(null)}
          className="min-h-10 rounded-lg bg-slate-800 px-4 text-xs text-slate-400 disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </section>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { CapabilityPanel } from './components/CapabilityPanel'
import { ClipInspector } from './components/ClipInspector'
import { EditToolbar } from './components/EditToolbar'
import { ExportPanel } from './components/ExportPanel'
import { FilePicker } from './components/FilePicker'
import { HelpPanel } from './components/HelpPanel'
import { Preview } from './components/Preview'
import { SubtitlePanel } from './components/SubtitlePanel'
import { ProjectList } from './components/ProjectList'
import { RelinkPanel } from './components/RelinkPanel'
import { StorageNotice } from './components/StorageNotice'
import { RejectedFiles } from './components/RejectedFiles'
import { Timeline } from './components/Timeline'
import { useProject } from './lib/project/store'
import { persistSources, useAutosave } from './lib/project/persist'
import {
  PROJECT_FILE_EXTENSION,
  ProjectFileError,
  buildProjectFile,
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
} from './lib/project/file'
import { detectCapabilities, type Capabilities } from './lib/capabilities'
import { useEditShortcuts } from './lib/useEditShortcuts'
import { useIsMobile } from './lib/useIsMobile'
import { timelineNotices } from './lib/project/limits'

export default function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  const timeline = useProject((state) => state.timeline)
  const rejected = useProject((state) => state.rejected)
  const importing = useProject((state) => state.importing)
  const addImported = useProject((state) => state.addImported)
  const setImporting = useProject((state) => state.setImporting)
  const clearRejected = useProject((state) => state.clearRejected)
  const projectName = useProject((state) => state.projectName)
  const projectId = useProject((state) => state.projectId)
  const setProjectName = useProject((state) => state.setProjectName)
  const storageWarning = useProject((state) => state.storageWarning)
  const setStorageWarning = useProject((state) => state.setStorageWarning)
  const setPendingRelink = useProject((state) => state.setPendingRelink)

  useEditShortcuts()
  useAutosave()
  const mobile = useIsMobile()

  useEffect(() => {
    let cancelled = false
    detectCapabilities().then((result) => {
      if (!cancelled) setCapabilities(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 편집 내용만 담은 작은 파일로 저장한다 (FR-024, AC-027).
   *
   * 링크를 화면에 두고 누른다. 즉석에서 만든 a 태그를 쓰면 저장되는 파일
   * 이름을 확인할 방법이 없어, 이름이 깨져도 아무도 모른다.
   */
  const projectLinkRef = useRef<HTMLAnchorElement>(null)
  const [projectFileUrl, setProjectFileUrl] = useState<string | null>(null)

  const saveProjectFile = useCallback(() => {
    const state = useProject.getState()
    const contents = serializeProjectFile(
      buildProjectFile({
        name: state.projectName,
        sources: state.sources,
        timeline: state.timeline,
        subtitles: state.subtitles,
        subtitleStyle: state.subtitleStyle,
        exportSetting: state.exportSetting,
      }),
    )
    setProjectFileUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    })
  }, [])

  // 주소가 준비된 뒤에 눌러야 한다. 같은 렌더에서 누르면 이전 내용이 저장된다.
  useEffect(() => {
    if (projectFileUrl) projectLinkRef.current?.click()
  }, [projectFileUrl])

  const handleSelect = useCallback(
    async (files: File[]) => {
      // 프로젝트 파일은 영상과 다른 길로 간다. 원본을 다시 연결해야 한다.
      const projectFile = files.find((file) =>
        file.name.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`),
      )
      if (projectFile) {
        try {
          const project = parseProjectFile(await projectFile.text())
          setPendingRelink({ project, resolved: {}, notes: [] })
        } catch (error) {
          setStorageWarning(
            error instanceof ProjectFileError ? error.message : '프로젝트 파일을 열 수 없습니다.',
          )
        }
        return
      }

      setImporting(true)
      // 인코딩 코드가 딸려 오므로 첫 화면 번들에 넣지 않고 이때 받아온다.
      const { importFiles } = await import('./lib/media/import')
      const outcome = await importFiles(files)
      addImported(outcome.sources, outcome.items, outcome.rejected)

      // 원본 복사는 화면을 막지 않는다. 편집은 이미 시작할 수 있는 상태다.
      const id = useProject.getState().projectId
      if (id && outcome.sources.length > 0) void persistSources(id, outcome.sources)
    },
    [addImported, setImporting, setPendingRelink, setStorageWarning],
  )

  return (
    <main
      className={`mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 ${
        mobile ? 'gap-5 pt-5 pb-28' : 'gap-8 py-10'
      }`}
    >
      <header className={mobile ? 'flex items-baseline gap-2' : undefined}>
        <p className="text-xs font-medium tracking-widest text-sky-400 uppercase">CutCap</p>
        {/* 좁은 화면에서는 제목이 첫 화면을 차지하지 않게 한 줄로 줄인다. */}
        <h1
          className={
            mobile
              ? 'text-sm font-semibold text-slate-300'
              : 'mt-2 text-2xl font-bold text-slate-50 sm:text-3xl'
          }
        >
          누구나 하는 컷편집과 캡션넣기
        </h1>
      </header>

      {projectId !== null && (
        <section className="flex items-center gap-2">
          <label htmlFor="project-name" className="shrink-0 text-xs text-slate-400">
            프로젝트 이름
          </label>
          <input
            id="project-name"
            data-testid="project-name"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-lg bg-slate-900 px-3 text-sm text-slate-100"
          />
          <button
            type="button"
            data-testid="save-project-file"
            onClick={saveProjectFile}
            className="min-h-10 shrink-0 rounded-lg bg-slate-800 px-3 text-xs text-slate-300 hover:bg-slate-700"
          >
            프로젝트 파일 저장
          </button>
          {projectFileUrl && (
            <a
              ref={projectLinkRef}
              href={projectFileUrl}
              download={projectFileName(projectName)}
              data-testid="project-file-link"
              className="sr-only"
            >
              프로젝트 파일 내려받기
            </a>
          )}
          <span data-testid="autosave-note" className="shrink-0 text-[11px] text-slate-500">
            자동 저장됨
          </span>
        </section>
      )}

      <StorageNotice />

      {/* 한계를 넘어도 편집을 막지는 않는다. 다만 모르고 있다가 내보내기에서
          실패하는 일이 없도록 미리 알린다 (PRD 11절). */}
      {timelineNotices(timeline).map((notice) => (
        <p
          key={notice.id}
          data-testid={`limit-notice-${notice.id}`}
          className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300"
        >
          {notice.message}
        </p>
      ))}

      {storageWarning && (
        <p
          data-testid="storage-warning"
          className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300"
        >
          {storageWarning}{' '}
          <button
            type="button"
            data-testid="dismiss-storage-warning"
            onClick={() => setStorageWarning(null)}
            className="underline"
          >
            닫기
          </button>
        </p>
      )}

      <section className="flex flex-col gap-4">
        <FilePicker
          onSelect={handleSelect}
          disabled={importing}
          compact={mobile && timeline.length > 0}
        />
        {importing && (
          <p data-testid="importing" className="text-sm text-slate-400">
            파일을 읽는 중…
          </p>
        )}
        <RejectedFiles files={rejected} onDismiss={clearRejected} />
        <RelinkPanel />
        <ProjectList />
      </section>

      {timeline.length > 0 && (
        <section
          data-testid="preview-section"
          className={
            mobile
              ? 'sticky top-0 z-20 -mx-4 flex flex-col gap-2 bg-slate-950/95 px-4 pt-2 pb-3 backdrop-blur'
              : 'flex flex-col gap-3'
          }
        >
          {!mobile && <h2 className="text-sm font-semibold text-slate-300">미리보기</h2>}
          <Preview />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-300">타임라인</h2>
        {/* 모바일에서는 같은 도구 바를 화면 아래에 고정해 한 손으로 누른다. */}
        {!mobile && <EditToolbar />}
        <Timeline />
        {timeline.length > 0 && <ClipInspector />}
        <HelpPanel />
      </section>

      {timeline.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-300">자막</h2>
          <SubtitlePanel />
        </section>
      )}

      {timeline.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-300">내보내기</h2>
          <ExportPanel />
        </section>
      )}

      {mobile && timeline.length > 0 && (
        <div
          data-testid="mobile-toolbar"
          className="fixed inset-x-0 bottom-0 z-30 overflow-x-auto border-t border-slate-800 bg-slate-950/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur"
        >
          <EditToolbar nowrap />
        </div>
      )}

      <section>
        <button
          type="button"
          onClick={() => setDiagnosticsOpen((open) => !open)}
          className="text-sm font-semibold text-slate-400 hover:text-slate-200"
        >
          이 기기 환경 점검 {diagnosticsOpen ? '숨기기' : '보기'}
        </button>

        {diagnosticsOpen && (
          <div className="mt-3">
            {capabilities === null ? (
              <p className="rounded-xl bg-slate-900/60 p-4 text-sm text-slate-400">확인하는 중…</p>
            ) : (
              <>
                <CapabilityPanel checks={capabilities.checks} />
                <p className="mt-4 text-xs leading-relaxed text-slate-500">
                  교차 출처 격리:{' '}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                    crossOriginIsolated = {String(capabilities.crossOriginIsolated)}
                  </code>
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

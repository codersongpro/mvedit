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
import { CheckIcon, DownloadIcon, SettingsIcon, VideocamIcon } from './components/icons'
import { TextField, btn, notice as notices, sectionTitle } from './components/m3'

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

  const diagnosticsRef = useRef<HTMLElement>(null)
  const openDiagnostics = () => {
    setDiagnosticsOpen(true)
    // 점검 결과는 화면 맨 아래에 있다. 앱 바에서 눌렀으면 거기까지 데려간다.
    requestAnimationFrame(() =>
      diagnosticsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  return (
    <div className="min-h-dvh bg-surface text-on-surface">
      {/* 모바일에서는 미리보기가 위에 붙는다. 앱 바까지 붙으면 둘이 겹쳐
          편집할 자리가 줄어든다. */}
      <div className={mobile ? undefined : 'sticky top-0 z-30 bg-surface'}>
        <div
          className={`mx-auto flex max-w-[880px] items-center gap-2 px-2 ${mobile ? 'h-14' : 'h-16'}`}
        >
          <span className="flex h-12 w-12 items-center justify-center text-on-surface">
            <VideocamIcon size={24} />
          </span>
          <p className="m3-title-large flex-1 text-on-surface">CutCap</p>
          <button
            type="button"
            aria-label="이 기기 환경 점검"
            title="이 기기 환경 점검"
            onClick={openDiagnostics}
            className={`${btn.icon} h-12 w-12`}
          >
            <SettingsIcon size={24} />
          </button>
        </div>
      </div>

      <main
        className={`mx-auto flex w-full max-w-[880px] flex-col px-4 ${
          mobile ? 'gap-5 pb-28' : 'gap-6 pt-2 pb-12'
        }`}
      >
        <header className="flex flex-col gap-1 px-1">
          {/* 좁은 화면에서는 제목이 첫 화면을 차지하지 않게 줄인다. */}
          <h1
            className={
              mobile ? 'm3-title-medium text-on-surface' : 'm3-headline-medium text-on-surface'
            }
          >
            누구나 하는 컷편집과 캡션넣기
          </h1>
          {!mobile && (
            <p className="m3-body-medium text-on-surface-variant">
              영상 파일은 기기를 벗어나지 않습니다. 인코딩까지 전부 브라우저 안에서 처리합니다.
            </p>
          )}
        </header>

        {projectId !== null && (
          <section className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <TextField
              id="project-name"
              label="프로젝트 이름"
              data-testid="project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="min-w-[220px] flex-1"
            />
            <button
              type="button"
              data-testid="save-project-file"
              onClick={saveProjectFile}
              className={`${btn.tonal} pl-4`}
            >
              <DownloadIcon size={18} />
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
            <span
              data-testid="autosave-note"
              className="flex shrink-0 items-center gap-1 m3-label-medium text-on-surface-variant"
            >
              <CheckIcon size={16} />
              자동 저장됨
            </span>
          </section>
        )}

        <StorageNotice />

        {/* 한계를 넘어도 편집을 막지는 않는다. 다만 모르고 있다가 내보내기에서
            실패하는 일이 없도록 미리 알린다 (PRD 11절). */}
        {timelineNotices(timeline).map((notice) => (
          <p key={notice.id} data-testid={`limit-notice-${notice.id}`} className={notices.warn}>
            {notice.message}
          </p>
        ))}

        {storageWarning && (
          <p
            data-testid="storage-warning"
            className={`${notices.warn} flex items-start justify-between gap-3`}
          >
            <span>{storageWarning}</span>
            <button
              type="button"
              data-testid="dismiss-storage-warning"
              onClick={() => setStorageWarning(null)}
              className="state-layer -my-1 shrink-0 rounded-full px-2 py-1 m3-label-medium"
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
            <p data-testid="importing" className="m3-body-medium text-on-surface-variant">
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
                ? 'sticky top-0 z-20 -mx-4 flex flex-col gap-2 bg-surface px-4 pt-2 pb-3'
                : 'flex flex-col gap-3'
            }
          >
            {!mobile && <h2 className={sectionTitle}>미리보기</h2>}
            <Preview />
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>타임라인</h2>
          {/* 모바일에서는 같은 도구 바를 화면 아래에 고정해 한 손으로 누른다. */}
          {!mobile && <EditToolbar />}
          <Timeline />
          {timeline.length > 0 && <ClipInspector />}
          <HelpPanel />
        </section>

        {timeline.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>자막</h2>
            <SubtitlePanel />
          </section>
        )}

        {timeline.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>내보내기</h2>
            <ExportPanel />
          </section>
        )}

        {mobile && timeline.length > 0 && (
          <div
            data-testid="mobile-toolbar"
            className="fixed inset-x-0 bottom-0 z-30 overflow-x-auto border-t border-outline-variant bg-surface-container px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          >
            <EditToolbar nowrap />
          </div>
        )}

        <section ref={diagnosticsRef} className="flex scroll-mt-20 flex-col gap-3">
          <button
            type="button"
            aria-expanded={diagnosticsOpen}
            onClick={() => setDiagnosticsOpen((open) => !open)}
            className={`${btn.text} self-start pl-3`}
          >
            <SettingsIcon size={18} />이 기기 환경 점검 {diagnosticsOpen ? '숨기기' : '보기'}
          </button>

          {diagnosticsOpen && (
            <div>
              {capabilities === null ? (
                <p className="rounded-m3-lg bg-surface-container p-4 m3-body-medium text-on-surface-variant">
                  확인하는 중…
                </p>
              ) : (
                <>
                  <CapabilityPanel checks={capabilities.checks} />
                  <p className="mt-4 mx-1 m3-body-small text-on-surface-variant">
                    교차 출처 격리:{' '}
                    <code className="rounded-md bg-surface-container-highest px-1.5 py-0.5 font-mono text-on-surface">
                      crossOriginIsolated = {String(capabilities.crossOriginIsolated)}
                    </code>
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        {/* 만든 사람. 화면 맨 아래에 조용히 둔다 — 편집을 방해하지 않으면서도
            누가 만들었는지 찾을 수 있어야 한다. */}
        <footer className="border-t border-outline-variant px-1 pt-4">
          <p className="m3-body-small text-on-surface-variant">
            <span className="m3-label-large text-on-surface">송동석</span> · Teacher / Data Analyst
            / App Developer
          </p>
        </footer>
      </main>
    </div>
  )
}

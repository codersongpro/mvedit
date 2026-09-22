import { useCallback, useEffect, useState } from 'react'
import { CapabilityPanel } from './components/CapabilityPanel'
import { ClipInspector } from './components/ClipInspector'
import { EditToolbar } from './components/EditToolbar'
import { ExportPanel } from './components/ExportPanel'
import { FilePicker } from './components/FilePicker'
import { HelpPanel } from './components/HelpPanel'
import { Preview } from './components/Preview'
import { SubtitlePanel } from './components/SubtitlePanel'
import { ProjectList } from './components/ProjectList'
import { RejectedFiles } from './components/RejectedFiles'
import { Timeline } from './components/Timeline'
import { useProject } from './lib/project/store'
import { persistSources, useAutosave } from './lib/project/persist'
import { detectCapabilities, type Capabilities } from './lib/capabilities'
import { useEditShortcuts } from './lib/useEditShortcuts'

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

  useEditShortcuts()
  useAutosave()

  useEffect(() => {
    let cancelled = false
    detectCapabilities().then((result) => {
      if (!cancelled) setCapabilities(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSelect = useCallback(
    async (files: File[]) => {
      setImporting(true)
      // 인코딩 코드가 딸려 오므로 첫 화면 번들에 넣지 않고 이때 받아온다.
      const { importFiles } = await import('./lib/media/import')
      const outcome = await importFiles(files)
      addImported(outcome.sources, outcome.items, outcome.rejected)

      // 원본 복사는 화면을 막지 않는다. 편집은 이미 시작할 수 있는 상태다.
      const id = useProject.getState().projectId
      if (id && outcome.sources.length > 0) void persistSources(id, outcome.sources)
    },
    [addImported, setImporting],
  )

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header>
        <p className="text-xs font-medium tracking-widest text-sky-400 uppercase">CutCap</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-50 sm:text-3xl">
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
          <span data-testid="autosave-note" className="shrink-0 text-[11px] text-slate-500">
            자동 저장됨
          </span>
        </section>
      )}

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
        <FilePicker onSelect={handleSelect} disabled={importing} />
        {importing && (
          <p data-testid="importing" className="text-sm text-slate-400">
            파일을 읽는 중…
          </p>
        )}
        <RejectedFiles files={rejected} onDismiss={clearRejected} />
        <ProjectList />
      </section>

      {timeline.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-300">미리보기</h2>
          <Preview />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-300">타임라인</h2>
        <EditToolbar />
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

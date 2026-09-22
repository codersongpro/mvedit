import { useCallback, useEffect, useRef, useState } from 'react'
import { useProject } from '../lib/project/store'
import { pickSupportedProfile } from '../lib/media/codecSupport'
import {
  MP4_PROFILE,
  type ExportCodecProfile,
  type ExportWorkerRequest,
  type ExportWorkerResponse,
} from '../lib/media/exportTypes'
import { formatBytes } from '../lib/format'
import { lowerResolution } from '../lib/media/outputSize'
import { ExportSettings } from './ExportSettings'

type Phase =
  | { status: 'idle' }
  | { status: 'exporting'; progress: number; retrying: boolean }
  | {
      status: 'done'
      url: string
      fileName: string
      size: number
      elapsedMs: number
      srtUrl: string | null
      srtFileName: string
      /** 목표 용량을 맞추려 다시 인코딩한 횟수 (AC-021) */
      retryCount: number
      /** 목표 용량(바이트). 설정하지 않았으면 null */
      targetBytes: number | null
    }
  | { status: 'error'; message: string }

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** 타임라인 전체를 하나의 영상으로 합쳐 내보낸다 (FR-020, FR-021, FR-037, FR-038). */
export function ExportPanel() {
  const sources = useProject((state) => state.sources)
  const timeline = useProject((state) => state.timeline)
  const subtitles = useProject((state) => state.subtitles)
  const subtitleStyle = useProject((state) => state.subtitleStyle)
  const setting = useProject((state) => state.exportSetting)
  const [profile, setProfile] = useState<ExportCodecProfile | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })

  // 결과 파일 이름은 첫 원본에서 따온다. 프로젝트 이름은 아직 없다.
  const exportBaseName =
    sources.find((source) => source.kind === 'video')?.fileName ?? sources[0]?.fileName ?? '영상'

  const workerRef = useRef<Worker | null>(null)
  const startedAtRef = useRef(0)
  const objectUrlRef = useRef<string[]>([])

  useEffect(() => {
    void pickSupportedProfile().then(setProfile)
  }, [])

  // 영상 버퍼는 수백 MB가 될 수 있다. 워커와 object URL을 반드시 정리한다.
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      for (const url of objectUrlRef.current) URL.revokeObjectURL(url)
    },
    [],
  )

  /**
   * 내보내는 중 창을 닫으려 하면 경고한다 (FR-030, AC-034).
   * 인코딩은 다시 시작하면 처음부터라 실수로 닫으면 시간을 통째로 잃는다.
   */
  useEffect(() => {
    if (phase.status !== 'exporting') return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase.status])

  const startExport = useCallback(() => {
    if (timeline.length === 0 || !profile) return

    for (const url of objectUrlRef.current) URL.revokeObjectURL(url)
    objectUrlRef.current = []

    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    startedAtRef.current = performance.now()
    setPhase({ status: 'exporting', progress: 0, retrying: false })

    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        setPhase((previous) => ({
          status: 'exporting',
          progress: message.progress,
          retrying: previous.status === 'exporting' ? previous.retrying : false,
        }))
        return
      }

      if (message.type === 'retrying') {
        setPhase({ status: 'exporting', progress: 0, retrying: true })
        return
      }

      if (message.type === 'done') {
        const blob = new Blob([message.buffer], { type: message.mimeType })
        const url = URL.createObjectURL(blob)
        objectUrlRef.current.push(url)

        let srtUrl: string | null = null
        if (message.srt) {
          srtUrl = URL.createObjectURL(new Blob([message.srt], { type: 'text/plain' }))
          objectUrlRef.current.push(srtUrl)
        }

        const name = baseName(exportBaseName)
        setPhase({
          status: 'done',
          url,
          fileName: `${name}_cutcap.${message.fileExtension}`,
          size: blob.size,
          elapsedMs: performance.now() - startedAtRef.current,
          srtUrl,
          srtFileName: `${name}_cutcap.srt`,
          retryCount: message.retryCount,
          targetBytes: message.targetBytes,
        })
      } else {
        setPhase({ status: 'error', message: message.message })
      }

      worker.terminate()
      workerRef.current = null
    }

    const request: ExportWorkerRequest = {
      type: 'start',
      job: {
        timeline,
        files: sources.map((source) => [source.id, source.file] as [string, File]),
        kinds: sources.map((source) => [source.id, source.kind] as [string, 'video' | 'image']),
        subtitles,
        subtitleStyle,
        setting,
        profile,
      },
    }
    worker.postMessage(request)
  }, [timeline, sources, subtitles, subtitleStyle, setting, profile, exportBaseName])

  const cancelExport = useCallback(() => {
    const request: ExportWorkerRequest = { type: 'cancel' }
    workerRef.current?.postMessage(request)
  }, [])

  if (timeline.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <ExportSettings />

      {profile && profile.id !== MP4_PROFILE.id && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300">
          이 브라우저는 MP4(H.264) 인코딩을 지원하지 않아 시험용으로 {profile.label} 형식으로
          내보냅니다.
        </p>
      )}
      {profile === null && (
        <p className="rounded-lg bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300">
          이 브라우저에서는 영상 내보내기를 지원하지 않습니다. 최신 Chrome, Edge, Safari에서 열어
          주세요.
        </p>
      )}

      {phase.status !== 'exporting' && profile && (
        <button
          type="button"
          data-testid="export-button"
          onClick={startExport}
          className="self-start rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
        >
          영상 내보내기
        </button>
      )}

      {phase.status === 'exporting' && (
        <div className="flex flex-col gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-sky-400 transition-[width] duration-200"
              style={{ width: `${Math.round(phase.progress * 100)}%` }}
            />
          </div>
          {phase.retrying && (
            <p data-testid="export-retrying" className="text-xs text-sky-300">
              목표 용량을 맞추려고 화질을 낮춰 다시 인코딩하는 중입니다 (1회)
            </p>
          )}
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span data-testid="export-progress">{Math.round(phase.progress * 100)}%</span>
            <button
              type="button"
              data-testid="cancel-export"
              onClick={cancelExport}
              className="text-rose-300 hover:text-rose-200"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {phase.status === 'done' && (
        <div
          data-testid="export-done"
          data-retry-count={phase.retryCount}
          className="flex flex-col gap-3 rounded-xl bg-emerald-500/10 p-4 ring-1 ring-emerald-500/20"
        >
          <p className="text-sm text-emerald-200">
            내보내기 완료 — {formatBytes(phase.size)} · {(phase.elapsedMs / 1000).toFixed(1)}초 소요
          </p>

          {/* 목표 용량을 못 맞춰도 만든 파일은 그대로 저장할 수 있다 (AC-022). */}
          {phase.targetBytes !== null && phase.size > phase.targetBytes && (
            <p data-testid="target-missed" className="text-xs leading-relaxed text-amber-300">
              목표 {formatBytes(phase.targetBytes)}를 맞추지 못했습니다(
              {formatBytes(phase.size)}).{' '}
              {lowerResolution(setting.resolution)
                ? `해상도를 ${lowerResolution(setting.resolution)}p로 낮춰 다시 내보내 보세요.`
                : '영상을 더 짧게 잘라 내보내 보세요.'}{' '}
              아래에서 지금 파일을 그대로 저장할 수도 있습니다.
            </p>
          )}
          {phase.targetBytes !== null && phase.size <= phase.targetBytes && (
            <p data-testid="target-met" className="text-xs text-emerald-300/80">
              목표 {formatBytes(phase.targetBytes)} 이하로 맞췄습니다
              {phase.retryCount > 0 ? ' (화질을 낮춰 1회 재인코딩)' : ''}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <a
              href={phase.url}
              download={phase.fileName}
              data-testid="download-link"
              className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
            >
              영상 저장
            </a>
            {phase.srtUrl && (
              <a
                href={phase.srtUrl}
                download={phase.srtFileName}
                data-testid="download-srt"
                className="rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700"
              >
                자막 파일(.srt) 저장
              </a>
            )}
          </div>
        </div>
      )}

      {phase.status === 'error' && (
        <p
          data-testid="export-error"
          className="rounded-lg bg-rose-500/10 p-3 text-sm leading-relaxed text-rose-300"
        >
          {phase.message}
        </p>
      )}
    </div>
  )
}

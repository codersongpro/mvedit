import { useCallback, useEffect, useRef, useState } from 'react'
import { findSource, useProject } from '../lib/project/store'
import { pickSupportedProfile } from '../lib/media/codecSupport'
import {
  MP4_PROFILE,
  type ExportCodecProfile,
  type ExportWorkerRequest,
  type ExportWorkerResponse,
} from '../lib/media/exportTypes'
import { formatBytes } from '../lib/format'

type Phase =
  | { status: 'idle' }
  | { status: 'exporting'; progress: number }
  | { status: 'done'; url: string; fileName: string; size: number; elapsedMs: number }
  | { status: 'error'; message: string }

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/**
 * 타임라인의 첫 영상 클립 하나를 내보낸다.
 *
 * 타임라인 전체를 하나로 합쳐 내보내는 것은 이후 단계에서 붙인다.
 * 지금은 인코딩 경로가 계속 살아 있는지 확인하는 용도다.
 */
export function ExportPanel() {
  const sources = useProject((state) => state.sources)
  const timeline = useProject((state) => state.timeline)
  const [profile, setProfile] = useState<ExportCodecProfile | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })

  const workerRef = useRef<Worker | null>(null)
  const startedAtRef = useRef(0)
  const objectUrlRef = useRef<string | null>(null)

  const firstVideoItem = timeline.find((item) => item.type === 'video') ?? null
  const firstVideoSource = findSource(sources, firstVideoItem?.sourceId ?? null)

  useEffect(() => {
    void pickSupportedProfile().then(setProfile)
  }, [])

  // 영상 버퍼는 수백 MB가 될 수 있다. 워커와 object URL을 반드시 정리한다.
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    },
    [],
  )

  const startExport = useCallback(() => {
    if (!firstVideoSource || !profile) return

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    startedAtRef.current = performance.now()
    setPhase({ status: 'exporting', progress: 0 })

    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        setPhase({ status: 'exporting', progress: message.progress })
        return
      }

      if (message.type === 'done') {
        const blob = new Blob([message.buffer], { type: message.mimeType })
        const url = URL.createObjectURL(blob)
        objectUrlRef.current = url
        setPhase({
          status: 'done',
          url,
          fileName: `${baseName(firstVideoSource.fileName)}_cutcap.${message.fileExtension}`,
          size: blob.size,
          elapsedMs: performance.now() - startedAtRef.current,
        })
      } else {
        setPhase({ status: 'error', message: message.message })
      }

      worker.terminate()
      workerRef.current = null
    }

    const request: ExportWorkerRequest = { type: 'start', file: firstVideoSource.file, profile }
    worker.postMessage(request)
  }, [firstVideoSource, profile])

  const cancelExport = useCallback(() => {
    const request: ExportWorkerRequest = { type: 'cancel' }
    workerRef.current?.postMessage(request)
  }, [])

  if (!firstVideoSource) return null

  return (
    <div className="flex flex-col gap-3">
      {profile && profile.id !== MP4_PROFILE.id && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300">
          이 브라우저는 MP4(H.264) 인코딩을 지원하지 않아 시험용으로 {profile.label} 형식으로
          내보냅니다.
        </p>
      )}
      {profile === null && (
        <p className="rounded-lg bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300">
          이 브라우저에서는 영상 내보내기를 지원하지 않습니다. 최신 Chrome, Edge, Safari에서
          열어 주세요.
        </p>
      )}

      {phase.status !== 'exporting' && profile && (
        <button
          type="button"
          data-testid="export-button"
          onClick={startExport}
          className="self-start rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
        >
          첫 영상 내보내기
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
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span data-testid="export-progress">{Math.round(phase.progress * 100)}%</span>
            <button
              type="button"
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
          className="flex flex-col gap-3 rounded-xl bg-emerald-500/10 p-4 ring-1 ring-emerald-500/20"
        >
          <p className="text-sm text-emerald-200">
            내보내기 완료 — {formatBytes(phase.size)} · {(phase.elapsedMs / 1000).toFixed(1)}초 소요
          </p>
          <a
            href={phase.url}
            download={phase.fileName}
            data-testid="download-link"
            className="self-start rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            파일 저장
          </a>
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

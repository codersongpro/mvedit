import { useCallback, useEffect, useRef, useState } from 'react'
import { FilePicker } from './FilePicker'
import type { MediaInfo } from '../lib/media/probe'
import { pickSupportedProfile } from '../lib/media/codecSupport'
import {
  EXPORT_ERROR_MESSAGE,
  MP4_PROFILE,
  type ExportCodecProfile,
  type ExportWorkerRequest,
  type ExportWorkerResponse,
} from '../lib/media/exportTypes'
import { formatBytes } from '../lib/capabilities'

type Phase =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready' }
  | { status: 'exporting'; progress: number }
  | { status: 'done'; url: string; fileName: string; size: number; elapsedMs: number }
  | { status: 'error'; message: string }

function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export function ExportPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [profile, setProfile] = useState<ExportCodecProfile | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })

  const workerRef = useRef<Worker | null>(null)
  const startedAtRef = useRef(0)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    void pickSupportedProfile().then(setProfile)
  }, [])

  // 생성한 object URL과 워커는 반드시 정리한다. 영상 버퍼는 수백 MB가 될 수 있다.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  const handleSelect = useCallback(async (selected: File) => {
    setFile(selected)
    setInfo(null)
    setPhase({ status: 'probing' })

    const { probeMedia } = await import('../lib/media/probe')
    const result = await probeMedia(selected)

    if (!result.ok) {
      setPhase({ status: 'error', message: EXPORT_ERROR_MESSAGE[result.code] })
      return
    }

    setInfo(result.info)
    setPhase({ status: 'ready' })
  }, [])

  const startExport = useCallback(() => {
    if (!file || !profile) return

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
          fileName: `${baseName(file.name)}_mvedit.${message.fileExtension}`,
          size: blob.size,
          elapsedMs: performance.now() - startedAtRef.current,
        })
      } else {
        setPhase({ status: 'error', message: message.message })
      }

      worker.terminate()
      workerRef.current = null
    }

    const request: ExportWorkerRequest = { type: 'start', file, profile }
    worker.postMessage(request)
  }, [file, profile])

  const cancelExport = useCallback(() => {
    const request: ExportWorkerRequest = { type: 'cancel' }
    workerRef.current?.postMessage(request)
  }, [])

  const busy = phase.status === 'probing' || phase.status === 'exporting'

  return (
    <div className="flex flex-col gap-4">
      <FilePicker onSelect={handleSelect} disabled={busy} />

      {profile && profile.id !== MP4_PROFILE.id && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300">
          이 브라우저는 MP4(H.264) 인코딩을 지원하지 않아 시험용으로 {profile.label} 형식으로
          내보냅니다. 실제 서비스에서는 MP4로만 내보냅니다.
        </p>
      )}
      {profile === null && (
        <p className="rounded-lg bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300">
          이 브라우저에서는 영상 내보내기를 지원하지 않습니다. 최신 Chrome, Edge, Safari에서
          열어 주세요.
        </p>
      )}

      {info && (
        <dl
          data-testid="media-info"
          className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-slate-900/60 p-4 text-sm sm:grid-cols-3"
        >
          <Field label="파일" value={info.fileName} wide />
          <Field label="길이" value={formatDuration(info.durationSeconds)} />
          <Field label="크기" value={`${info.displayWidth}×${info.displayHeight}`} />
          <Field label="용량" value={formatBytes(info.fileSize)} />
          <Field label="영상 코덱" value={info.videoCodec ?? '없음'} />
          <Field label="소리" value={info.hasAudio ? (info.audioCodec ?? '있음') : '없음'} />
          <Field label="회전" value={`${info.rotation}°`} />
        </dl>
      )}

      {phase.status === 'probing' && <Notice>파일을 읽는 중…</Notice>}

      {info && phase.status === 'ready' && profile && (
        <button
          type="button"
          data-testid="export-button"
          onClick={startExport}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
        >
          {profile.label}로 내보내기
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
            <button type="button" onClick={cancelExport} className="text-rose-300 hover:text-rose-200">
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

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : undefined}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200">{value}</dd>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-slate-900/60 p-3 text-sm text-slate-400">{children}</p>
}

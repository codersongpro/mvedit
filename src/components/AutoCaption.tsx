import { useEffect, useMemo, useRef, useState } from 'react'
import { useProject } from '../lib/project/store'
import type { MediaSource, TimelineItem } from '../lib/project/types'
import {
  MODELS,
  canRunAccurate,
  detectDevice,
  resolveModel,
  type CaptionLanguage,
  type DeviceInfo,
  type ModelChoice,
} from '../lib/autocaption/models'
import type { CaptionJob, CaptionProgress } from '../lib/autocaption/run'
import { Row, Segmented, btn, notice } from './m3'

type Phase =
  | { status: 'idle' }
  | { status: 'confirm'; jobs: CaptionJob[] }
  | { status: 'running'; progress: CaptionProgress }
  | { status: 'done'; count: number }
  | { status: 'error'; message: string }

const LANGUAGES: { value: CaptionLanguage; label: string }[] = [
  { value: 'korean', label: '한국어' },
  { value: 'english', label: '영어' },
  { value: 'auto', label: '자동 감지' },
]

const CHOICES: { value: ModelChoice; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'fast', label: MODELS.fast.label },
  { value: 'balanced', label: MODELS.balanced.label },
  { value: 'accurate', label: MODELS.accurate.label },
]

/** 말소리가 들어 있어 인식할 수 있는 클립. 음소거한 클립은 들리지 않으니 뺀다. */
function toJob(item: TimelineItem, sources: MediaSource[]): CaptionJob | null {
  if (item.type !== 'video' && item.type !== 'audio') return null
  if (item.muted) return null
  const source = sources.find((candidate) => candidate.id === item.sourceId)
  if (!source?.hasAudio) return null
  return { clipId: item.id, file: source.file, start: item.inPoint, end: item.outPoint }
}

function describeError(code: string): string {
  if (code === 'model-load') {
    return '음성 인식 모델을 내려받지 못했습니다. 인터넷 연결을 확인하거나 ‘빠름’ 모델로 다시 시도해 주세요.'
  }
  return '음성을 인식하지 못했습니다. 기기 메모리가 부족할 수 있으니 ‘빠름’ 모델로 다시 시도해 주세요.'
}

/**
 * 자동 자막 (FR-039).
 *
 * 영상·음성은 기기 밖으로 나가지 않는다. 내려받는 것은 모델뿐이고, 한 번
 * 받으면 브라우저에 남아 다음부터는 오프라인에서도 돈다.
 */
export function AutoCaption() {
  const timeline = useProject((state) => state.timeline)
  const sources = useProject((state) => state.sources)
  const subtitles = useProject((state) => state.subtitles)
  const selectedItemId = useProject((state) => state.selectedItemId)
  const applyAutoSubtitles = useProject((state) => state.applyAutoSubtitles)

  const [language, setLanguage] = useState<CaptionLanguage>('korean')
  const [choice, setChoice] = useState<ModelChoice>('auto')
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    void detectDevice().then((info) => alive && setDevice(info))
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [])

  const allJobs = useMemo(
    () => timeline.map((item) => toJob(item, sources)).filter((job) => job !== null),
    [timeline, sources],
  )
  const selectedJob = allJobs.find((job) => job.clipId === selectedItemId) ?? null
  const model = device ? resolveModel(choice, device) : null
  const running = phase.status === 'running'

  const start = (jobs: CaptionJob[]) => {
    if (jobs.length === 0) return
    const ids = new Set(jobs.map((job) => job.clipId))
    if (subtitles.some((subtitle) => ids.has(subtitle.clipId))) {
      setPhase({ status: 'confirm', jobs })
      return
    }
    void run(jobs, 'append')
  }

  const run = async (jobs: CaptionJob[], mode: 'replace' | 'append') => {
    if (!device || !model) return
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ status: 'running', progress: { stage: 'download', ratio: null } })
    try {
      // 무거운 모델 코드는 이 기능을 쓸 때만 받는다. 첫 화면을 느리게 만들지 않기 위해서다.
      const { runAutoCaption } = await import('../lib/autocaption/run')
      const results = await runAutoCaption(jobs, {
        model,
        device,
        language,
        signal: controller.signal,
        onProgress: (progress) => setPhase({ status: 'running', progress }),
      })
      applyAutoSubtitles(results, mode)
      setPhase({
        status: 'done',
        count: results.reduce((sum, result) => sum + result.lines.length, 0),
      })
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'transcribe'
      setPhase(
        code === 'canceled'
          ? { status: 'idle' }
          : { status: 'error', message: describeError(code) },
      )
    } finally {
      abortRef.current = null
    }
  }

  if (allJobs.length === 0) return null

  const progressRatio = phase.status === 'running' ? (phase.progress.ratio ?? 0) : 0
  const progressLabel =
    phase.status !== 'running'
      ? ''
      : phase.progress.stage === 'download'
        ? phase.progress.ratio === null
          ? '음성 인식 모델을 준비하는 중'
          : `모델 내려받는 중 ${Math.round(phase.progress.ratio * 100)}%`
        : `말소리 인식 중 ${Math.round(phase.progress.ratio * 100)}%`

  return (
    <div
      data-testid="autocaption"
      className="flex flex-col gap-4 rounded-m3-lg border border-outline-variant bg-surface-container-low p-4"
    >
      <div className="flex flex-col gap-1">
        <span className="m3-title-small text-on-surface">자동 자막</span>
        <span className="m3-body-small text-on-surface-variant">
          영상 속 말소리를 이 기기에서 바로 글자로 바꿉니다. 영상과 음성은 밖으로 보내지 않습니다.
          {model &&
            ` 처음 한 번 모델(약 ${model.approxMb >= 1000 ? '1GB' : `${model.approxMb}MB`})을 내려받습니다.`}
        </span>
      </div>

      <Row label="언어" width="sm:w-[88px]">
        <Segmented
          testIdPrefix="caption-lang"
          options={LANGUAGES}
          value={language}
          onChange={setLanguage}
        />
      </Row>

      <Row label="모델" width="sm:w-[88px]">
        <Segmented
          testIdPrefix="caption-model"
          options={CHOICES}
          value={choice}
          onChange={setChoice}
        />
      </Row>
      {device && (
        <p data-testid="caption-model-note" className="m3-body-small text-on-surface-variant">
          {model && `지금 쓸 모델: ${model.label}`}
          {device.webgpu
            ? ' · 그래픽 가속(WebGPU) 사용'
            : ' · 그래픽 가속이 없어 CPU로 처리해 느릴 수 있습니다'}
          {choice === 'accurate' &&
            !canRunAccurate(device) &&
            ' · 이 기기는 ‘정확’ 모델을 감당하기 어려워 ‘보통’으로 처리합니다'}
        </p>
      )}

      {phase.status === 'confirm' ? (
        <div data-testid="caption-confirm" className={`${notice.warn} flex flex-col gap-3`}>
          <span>이미 자막이 있는 클립이 있습니다. 어떻게 할까요?</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="caption-replace"
              className={btn.filled}
              onClick={() => void run(phase.jobs, 'replace')}
            >
              자동 자막으로 교체
            </button>
            <button
              type="button"
              data-testid="caption-append"
              className={btn.tonal}
              onClick={() => void run(phase.jobs, 'append')}
            >
              기존 자막 두고 추가
            </button>
            <button
              type="button"
              data-testid="caption-cancel-confirm"
              className={btn.text}
              onClick={() => setPhase({ status: 'idle' })}
            >
              취소
            </button>
          </div>
        </div>
      ) : running ? (
        <div className="flex flex-col gap-2">
          <div className="h-1 overflow-hidden rounded-full bg-secondary-container">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(progressRatio * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between m3-body-medium text-on-surface-variant">
            <span data-testid="caption-progress">{progressLabel}</span>
            <button
              type="button"
              data-testid="caption-stop"
              className={btn.text}
              onClick={() => abortRef.current?.abort()}
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="caption-selected"
            className={btn.tonal}
            disabled={!selectedJob || !device}
            title={selectedJob ? undefined : '타임라인에서 소리가 있는 클립을 먼저 고르세요'}
            onClick={() => selectedJob && start([selectedJob])}
          >
            선택한 클립 자동 자막
          </button>
          <button
            type="button"
            data-testid="caption-all"
            className={btn.filled}
            disabled={!device}
            onClick={() => start(allJobs)}
          >
            전체 자동 자막
          </button>
        </div>
      )}

      {phase.status === 'done' && (
        <p data-testid="caption-done" className="m3-body-small text-primary">
          {phase.count > 0
            ? `자막 ${phase.count}개를 넣었습니다. 틀린 글자는 아래 목록에서 고쳐 주세요.`
            : '알아들을 수 있는 말소리를 찾지 못했습니다.'}
        </p>
      )}
      {phase.status === 'error' && (
        <p data-testid="caption-error" className={notice.error}>
          {phase.message}
        </p>
      )}
    </div>
  )
}

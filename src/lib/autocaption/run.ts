import type { WorkerRequest, WorkerResponse } from '../../workers/transcribe.worker'
import { ASR_SAMPLE_RATE, extractSpeechPcm } from './audio'
import { chunksToLines, planWindows, rmsOf, SILENCE_RMS, type CaptionLine } from './lines'
import { runtimeOf, type CaptionLanguage, type DeviceInfo, type ModelSpec } from './models'

/** 인식할 클립 하나. 시각은 원본 시간축이다. */
export interface CaptionJob {
  clipId: string
  file: File
  start: number
  end: number
}

export type CaptionProgress =
  | { stage: 'download'; ratio: number | null }
  | { stage: 'transcribe'; ratio: number }

export class CaptionError extends Error {
  constructor(
    readonly code: 'model-load' | 'transcribe' | 'canceled',
    detail?: string,
  ) {
    super(detail ?? code)
    this.name = 'CaptionError'
  }
}

/**
 * 모델을 올린 워커를 붙잡아 둔다. 클립마다, 실행마다 새로 올리면 수백 MB 를
 * 매번 다시 읽어 GPU 에 올리느라 수십 초가 날아간다.
 */
let loaded: { worker: Worker; modelId: string } | null = null

function dropWorker() {
  loaded?.worker.terminate()
  loaded = null
}

function createWorker(): Worker {
  return new Worker(new URL('../../workers/transcribe.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function waitFor<T extends WorkerResponse['type']>(
  worker: Worker,
  type: T,
  signal: AbortSignal,
  onMessage?: (message: WorkerResponse) => void,
): Promise<Extract<WorkerResponse, { type: T }>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', listener)
      worker.removeEventListener('error', fail)
      signal.removeEventListener('abort', abort)
    }
    const listener = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      onMessage?.(message)
      if (message.type === type) {
        cleanup()
        resolve(message as Extract<WorkerResponse, { type: T }>)
      } else if (message.type === 'error') {
        cleanup()
        reject(new CaptionError(type === 'ready' ? 'model-load' : 'transcribe', message.message))
      }
    }
    const fail = (event: ErrorEvent) => {
      cleanup()
      reject(new CaptionError('model-load', event.message))
    }
    const abort = () => {
      cleanup()
      reject(new CaptionError('canceled'))
    }
    worker.addEventListener('message', listener)
    worker.addEventListener('error', fail)
    signal.addEventListener('abort', abort)
  })
}

async function ensureModel(
  model: ModelSpec,
  device: DeviceInfo,
  signal: AbortSignal,
  onProgress: (progress: CaptionProgress) => void,
): Promise<Worker> {
  if (loaded?.modelId === model.id) return loaded.worker
  dropWorker()
  const worker = createWorker()
  const runtime = runtimeOf(model, device)
  onProgress({ stage: 'download', ratio: null })
  const ready = waitFor(worker, 'ready', signal, (message) => {
    if (message.type === 'load-progress') {
      onProgress({ stage: 'download', ratio: message.loaded / message.total })
    }
  })
  worker.postMessage({
    type: 'load',
    modelId: model.id,
    device: runtime.device,
    dtype: runtime.dtype,
  } satisfies WorkerRequest)
  try {
    await ready
  } catch (error) {
    worker.terminate()
    throw error
  }
  loaded = { worker, modelId: model.id }
  return worker
}

/**
 * 클립들의 말소리를 인식해 자막 줄을 만든다.
 *
 * 진행률은 처리한 소리 길이 기준이다. 클립 개수 기준이면 10초짜리와
 * 10분짜리가 같은 무게가 돼 막대가 엉뚱하게 움직인다.
 */
export async function runAutoCaption(
  jobs: CaptionJob[],
  {
    model,
    device,
    language,
    signal,
    onProgress,
  }: {
    model: ModelSpec
    device: DeviceInfo
    language: CaptionLanguage
    signal: AbortSignal
    onProgress: (progress: CaptionProgress) => void
  },
): Promise<{ clipId: string; lines: CaptionLine[] }[]> {
  try {
    const worker = await ensureModel(model, device, signal, onProgress)
    const totalSeconds = jobs.reduce((sum, job) => sum + (job.end - job.start), 0) || 1
    let doneSeconds = 0
    let nextId = 0
    const results: { clipId: string; lines: CaptionLine[] }[] = []
    onProgress({ stage: 'transcribe', ratio: 0 })

    for (const job of jobs) {
      if (signal.aborted) throw new CaptionError('canceled')
      const pcm = await extractSpeechPcm(job.file, job.start, job.end)
      const lines: CaptionLine[] = []
      if (pcm) {
        for (const [windowStart, windowEnd] of planWindows(pcm, ASR_SAMPLE_RATE)) {
          if (signal.aborted) throw new CaptionError('canceled')
          // 통째로 조용한 창은 모델에 넣지 않는다. 시간도 아끼고 지어낸 문장도 막는다.
          if (rmsOf(pcm, ASR_SAMPLE_RATE, windowStart, windowEnd) >= SILENCE_RMS) {
            const id = nextId++
            const slice = pcm.slice(
              Math.floor(windowStart * ASR_SAMPLE_RATE),
              Math.ceil(windowEnd * ASR_SAMPLE_RATE),
            )
            const answer = waitFor(worker, 'result', signal)
            worker.postMessage(
              {
                type: 'transcribe',
                id,
                pcm: slice,
                language: language === 'auto' ? null : language,
              } satisfies WorkerRequest,
              [slice.buffer],
            )
            const { chunks } = await answer
            lines.push(
              ...chunksToLines({
                chunks,
                pcm,
                sampleRate: ASR_SAMPLE_RATE,
                windowStart,
                windowEnd,
                offset: job.start,
              }),
            )
          }
          onProgress({
            stage: 'transcribe',
            ratio: Math.min(1, (doneSeconds + windowEnd) / totalSeconds),
          })
        }
      }
      doneSeconds += job.end - job.start
      results.push({ clipId: job.clipId, lines })
    }
    return results
  } catch (error) {
    // 취소·실패한 워커는 추론 도중일 수 있어 그대로 다시 쓰지 않는다.
    if (error instanceof CaptionError && error.code !== 'model-load') dropWorker()
    if (error instanceof CaptionError) throw error
    throw new CaptionError('transcribe', String((error as Error)?.message ?? error))
  }
}

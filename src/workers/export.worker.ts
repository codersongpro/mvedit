/// <reference lib="webworker" />
import { composeTimeline, type ComposeInput, type ComposeResult } from '../lib/media/composeExport'
import { toExportError } from '../lib/media/export'
import { MB, MIN_VIDEO_BITRATE } from '../lib/media/outputSize'
import {
  EXPORT_ERROR_MESSAGE,
  type ExportWorkerRequest,
  type ExportWorkerResponse,
} from '../lib/media/exportTypes'

// 인코딩은 메인 스레드를 오래 막는다. 워커에서 돌려야 진행률 표시와
// 취소 버튼이 살아 있다.
let abortController: AbortController | null = null

/**
 * 다시 인코딩할 때 목표보다 조금 더 낮게 잡는다.
 *
 * 비율 그대로 낮추면 인코더가 또 목표에 붙어 살짝 넘길 수 있다. 재시도는
 * 한 번뿐이라 여유를 두는 쪽이 낫다 (FR-019).
 */
const RETRY_SAFETY = 0.9

function post(message: ExportWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(message, { transfer })
}

self.onmessage = async (event: MessageEvent<ExportWorkerRequest>) => {
  const request = event.data

  if (request.type === 'cancel') {
    abortController?.abort()
    return
  }

  abortController = new AbortController()

  try {
    const { job } = request
    const input: ComposeInput = {
      timeline: job.timeline,
      files: new Map(job.files),
      kinds: new Map(job.kinds),
      subtitles: job.subtitles,
      subtitleStyle: job.subtitleStyle,
      setting: job.setting,
      profile: job.profile,
    }
    const options = {
      signal: abortController.signal,
      onProgress: (progress: number, processedTime: number) =>
        post({ type: 'progress', progress, processedTime }),
    }

    let result: ComposeResult = await composeTimeline(input, options)

    const targetBytes = job.setting.targetSizeMb === null ? null : job.setting.targetSizeMb * MB
    let retryCount = 0

    // 목표를 넘으면 비트레이트를 낮춰 딱 한 번만 다시 인코딩한다. 두 번,
    // 세 번 반복하면 될 때까지 기다리게 되고, 안 될 때는 시간만 버린다.
    // 이미 최소 비트레이트라면 다시 해도 같은 결과여서 시도하지 않는다.
    if (
      targetBytes !== null &&
      result.buffer.byteLength > targetBytes &&
      result.videoBitrate > MIN_VIDEO_BITRATE
    ) {
      post({ type: 'retrying', firstSize: result.buffer.byteLength, targetBytes })
      const ratio = targetBytes / result.buffer.byteLength
      const nextBitrate = Math.max(
        MIN_VIDEO_BITRATE,
        Math.floor(result.videoBitrate * ratio * RETRY_SAFETY),
      )
      result = await composeTimeline({ ...input, bitrateOverride: nextBitrate }, options)
      retryCount = 1
    }

    post(
      {
        type: 'done',
        buffer: result.buffer,
        mimeType: result.mimeType,
        fileExtension: result.fileExtension,
        srt: result.srt,
        retryCount,
        targetBytes,
      },
      [result.buffer],
    )
  } catch (error) {
    const exportError = toExportError(error)
    post({
      type: 'error',
      code: exportError.code,
      message: EXPORT_ERROR_MESSAGE[exportError.code],
    })
  } finally {
    abortController = null
  }
}

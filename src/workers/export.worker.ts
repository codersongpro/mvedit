/// <reference lib="webworker" />
import { exportSingleVideo, toExportError } from '../lib/media/export'
import {
  EXPORT_ERROR_MESSAGE,
  type ExportWorkerRequest,
  type ExportWorkerResponse,
} from '../lib/media/exportTypes'

// 인코딩은 메인 스레드를 오래 막는다. 워커에서 돌려야 진행률 표시와
// 취소 버튼이 살아 있다.
let abortController: AbortController | null = null

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
    const result = await exportSingleVideo(request.file, request.profile, {
      signal: abortController.signal,
      onProgress: (progress, processedTime) => post({ type: 'progress', progress, processedTime }),
    })

    post(
      {
        type: 'done',
        buffer: result.buffer,
        mimeType: result.mimeType,
        fileExtension: result.fileExtension,
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

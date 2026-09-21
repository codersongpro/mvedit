import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import type { ExportCodecProfile, ExportErrorCode } from './exportTypes'

export interface ExportResult {
  buffer: ArrayBuffer
  mimeType: string
  fileExtension: string
}

export interface ExportOptions {
  onProgress?: (progress: number, processedTime: number) => void
  signal?: AbortSignal
}

/**
 * 영상 파일 하나를 통째로 다시 인코딩해 내보낸다.
 *
 * Phase 2의 최소 경로다. 자르기도 합성도 하지 않고 디코드 → 인코드 → 먹싱만 지난다.
 * 이 경로가 뚫려야 이후의 타임라인 편집·자막 굽기가 같은 파이프라인 위에 올라간다.
 */
export async function exportSingleVideo(
  file: File,
  profile: ExportCodecProfile,
  { onProgress, signal }: ExportOptions = {},
): Promise<ExportResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const output = new Output({
    format: profile.id === 'mp4-h264-aac' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  })

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      codec: profile.videoCodec,
      // 회전을 메타데이터로 남기지 않고 픽셀에 직접 구워 넣는다.
      // 메타데이터 방식은 일부 플레이어와 업무 시스템이 무시해 영상이 눕는다.
      allowTransformationMetadata: false,
    },
    audio: { codec: profile.audioCodec },
    // 무조건 재인코딩한다. 원본 복사로 빠져나가면 검증하려는 경로를 지나지 않는다.
    copy: false,
  })

  if (!conversion.isValid) {
    input.dispose()
    throw new ExportError('codec-unsupported', describeDiscardedTracks(conversion))
  }

  if (onProgress) {
    conversion.onProgress = (progress, processedTime) => onProgress(progress, processedTime)
  }

  const onAbort = () => void conversion.cancel()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await conversion.execute()

    const buffer = output.target.buffer
    if (!buffer) throw new ExportError('unknown', '출력 데이터가 비어 있습니다.')

    return { buffer, mimeType: profile.mimeType, fileExtension: profile.fileExtension }
  } catch (error) {
    throw toExportError(error)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    input.dispose()
  }
}

function describeDiscardedTracks(conversion: Conversion): string {
  const reasons = conversion.discardedTracks.map((track) => track.reason).join(', ')
  return reasons ? `사용할 수 없는 트랙: ${reasons}` : '변환할 수 있는 트랙이 없습니다.'
}

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    detail?: string,
  ) {
    super(detail ?? code)
    this.name = 'ExportError'
  }
}

/** 라이브러리·브라우저가 던지는 오류를 사용자에게 설명 가능한 분류로 바꾼다. */
export function toExportError(error: unknown): ExportError {
  if (error instanceof ExportError) return error
  if (error instanceof ConversionCanceledError) return new ExportError('canceled')

  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError' || /out of memory|allocation/i.test(error.message)) {
      return new ExportError('out-of-memory', error.message)
    }
    if (error.name === 'NotSupportedError' || /codec|not supported/i.test(error.message)) {
      return new ExportError('codec-unsupported', error.message)
    }
    return new ExportError('unknown', error.message)
  }

  return new ExportError('unknown')
}

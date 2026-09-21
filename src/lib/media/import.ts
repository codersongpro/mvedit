import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'
import {
  DEFAULT_IMAGE_DURATION,
  type MediaSource,
  type RejectedFile,
  type TimelineItem,
} from '../project/types'

/**
 * 썸네일은 원본 비율을 그대로 유지한다. 예전처럼 16:9 로 고정해 두면
 * 세로 영상이 좌우 여백투성이가 되고, 타임라인에서 클립 폭에 맞춰
 * 다시 잘리면서 무슨 장면인지 알아볼 수 없게 된다.
 * 높이만 맞추고 너비는 비율에서 계산해, 타임라인이 가로로 반복해 쓴다.
 */
const THUMBNAIL_HEIGHT = 96
const MIN_THUMBNAIL_WIDTH = 24
const MAX_THUMBNAIL_WIDTH = 320

function thumbnailWidthFor(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return THUMBNAIL_HEIGHT
  }
  const scaled = Math.round((THUMBNAIL_HEIGHT * width) / height)
  return Math.min(MAX_THUMBNAIL_WIDTH, Math.max(MIN_THUMBNAIL_WIDTH, scaled))
}

export interface ImportOutcome {
  sources: MediaSource[]
  items: TimelineItem[]
  rejected: RejectedFile[]
}

/**
 * 고른 파일들을 타임라인에 넣을 수 있는 형태로 바꾼다.
 *
 * 한 파일이 실패해도 나머지는 계속 처리한다(FR-003). 영상 편집 중에
 * 파일 하나 때문에 전체가 멈추면 사용자는 어느 파일이 문제인지 알 수 없다.
 */
export async function importFiles(files: File[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { sources: [], items: [], rejected: [] }

  for (const file of files) {
    try {
      const source = file.type.startsWith('image/')
        ? await readImage(file)
        : await readVideo(file)

      if (!source) {
        outcome.rejected.push({
          fileName: file.name,
          reason: '이 브라우저에서 열 수 없는 형식입니다.',
        })
        continue
      }

      outcome.sources.push(source)
      outcome.items.push(createItem(source))
    } catch {
      outcome.rejected.push({
        fileName: file.name,
        reason: '파일을 읽는 중 문제가 생겼습니다. 손상된 파일일 수 있습니다.',
      })
    }
  }

  return outcome
}

async function readVideo(file: File): Promise<MediaSource | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    if (!(await input.canRead())) return null

    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) return null

    const audioTrack = await input.getPrimaryAudioTrack()
    const durationSeconds = await input.computeDuration()

    return {
      id: crypto.randomUUID(),
      kind: 'video',
      file,
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      displayWidth: videoTrack.displayWidth,
      displayHeight: videoTrack.displayHeight,
      durationSeconds,
      rotation: await videoTrack.getRotation(),
      videoCodec: videoTrack.codec,
      audioCodec: audioTrack?.codec ?? null,
      hasAudio: audioTrack !== null,
      // 영상 한가운데 프레임을 쓴다. 첫 프레임은 검은 화면이거나 페이드인인
      // 경우가 많아 어떤 영상인지 알아보기 어렵다.
      thumbnailUrl: await grabThumbnail(videoTrack, durationSeconds / 2),
    }
  } finally {
    input.dispose()
  }
}

async function grabThumbnail(
  videoTrack: Awaited<ReturnType<Input['getPrimaryVideoTrack']>>,
  timestamp: number,
): Promise<string | null> {
  if (!videoTrack) return null
  try {
    const sink = new VideoSampleSink(videoTrack)
    const sample = await sink.getSample(timestamp)
    if (!sample) return null

    const canvas = document.createElement('canvas')
    canvas.width = thumbnailWidthFor(videoTrack.displayWidth, videoTrack.displayHeight)
    canvas.height = THUMBNAIL_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) return null

    // 캔버스가 이미 원본 비율이므로 cover 로 채워도 잘리는 부분이 없다.
    // drawWithFit 은 회전까지 처리한다 — 직접 계산하면 세로 영상이 눕는다.
    sample.drawWithFit(context, { fit: 'cover' })
    sample.close()

    return canvas.toDataURL('image/jpeg', 0.75)
  } catch {
    return null
  }
}

async function readImage(file: File): Promise<MediaSource | null> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = thumbnailWidthFor(bitmap.width, bitmap.height)
    canvas.height = THUMBNAIL_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) return null

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    return {
      id: crypto.randomUUID(),
      kind: 'image',
      file,
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      displayWidth: bitmap.width,
      displayHeight: bitmap.height,
      durationSeconds: null,
      rotation: 0,
      videoCodec: null,
      audioCodec: null,
      hasAudio: false,
      thumbnailUrl: canvas.toDataURL('image/jpeg', 0.75),
    }
  } finally {
    bitmap.close()
  }
}

function createItem(source: MediaSource): TimelineItem {
  const isVideo = source.kind === 'video'
  return {
    id: crypto.randomUUID(),
    type: isVideo ? 'video' : 'image',
    sourceId: source.id,
    inPoint: 0,
    outPoint: isVideo ? (source.durationSeconds ?? 0) : 0,
    duration: isVideo ? 0 : DEFAULT_IMAGE_DURATION,
    volume: 1,
    muted: false,
    color: '#000000',
  }
}

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  WebMOutputFormat,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny'
import { toSegments, type Segment } from '../project/playback'
import { subtitleAt } from '../project/subtitles'
import type { ExportSetting, Subtitle, SubtitleStyle, TimelineItem } from '../project/types'
import { computeOutputSize, estimateVideoBitrate, AUDIO_BITRATE } from './outputSize'
import { drawSubtitle } from './drawSubtitle'
import { toTimedSubtitles } from './srt'
import { ExportError, toExportError } from './export'
import type { ExportCodecProfile } from './exportTypes'

/** 사진·빈 화면 구간의 프레임율. 정지 화면이라 낮아도 되지만, 자막이
 *  바뀌는 게 보일 만큼은 필요하다. */
const STILL_FPS = 10

/**
 * 오디오 기본 형식.
 *
 * 소스는 "오디오 파라미터가 일정해야 한다"고 요구한다. 넣는 샘플의 채널 수나
 * 샘플레이트가 중간에 바뀌면 거부하므로, 원본이 모노든 스테레오든 44.1kHz든
 * **우리가 직접 한 가지 형식으로 맞춘 뒤** 넘긴다. 기준은 첫 오디오 트랙의
 * 형식을 따르고, 오디오가 아예 없으면 이 값을 쓴다.
 */
const FALLBACK_SAMPLE_RATE = 48000
const FALLBACK_CHANNELS = 2

interface AudioFormat {
  sampleRate: number
  numberOfChannels: number
}

/** 무음을 한 번에 얼마씩 만들지. 너무 크면 메모리를, 너무 작으면 호출을 낭비한다. */
const SILENCE_CHUNK_SECONDS = 0.1

export interface ComposeInput {
  timeline: TimelineItem[]
  /** 원본 id → 파일 */
  files: Map<string, File>
  /** 원본 id → 종류 */
  kinds: Map<string, 'video' | 'image'>
  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  setting: ExportSetting
  profile: ExportCodecProfile
}

export interface ComposeOptions {
  onProgress?: (progress: number, processedTime: number) => void
  signal?: AbortSignal
}

export interface ComposeResult {
  buffer: ArrayBuffer
  mimeType: string
  fileExtension: string
  /** 자막이 있을 때만 채워진다 */
  srt: string | null
}

/**
 * 타임라인 전체를 하나의 영상으로 합쳐 내보낸다 (FR-020, FR-037).
 *
 * 구간을 순서대로 지나며 프레임과 소리를 출력 시간축으로 옮겨 붙인다.
 * 영상·사진·빈 화면이 섞여 있어도 소리 길이가 영상 길이와 어긋나지 않도록,
 * 소리가 없는 구간에는 그만큼의 무음을 채워 넣는다 (AC-013).
 */
export async function composeTimeline(
  input: ComposeInput,
  { onProgress, signal }: ComposeOptions = {},
): Promise<ComposeResult> {
  const segments = toSegments(input.timeline)
  if (segments.length === 0) throw new ExportError('no-video-track', '타임라인이 비어 있습니다.')

  const totalDuration = segments.at(-1)?.end ?? 0
  const inputs: Input[] = []

  try {
    // 원본마다 한 번만 열고 구간마다 재사용한다.
    const opened = new Map<string, Input>()
    const openInput = (sourceId: string) => {
      const existing = opened.get(sourceId)
      if (existing) return existing
      const file = input.files.get(sourceId)
      if (!file) throw new ExportError('unreadable', '원본 파일을 찾을 수 없습니다.')
      const created = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
      opened.set(sourceId, created)
      inputs.push(created)
      return created
    }

    const sourceSize = await resolveSourceSize(segments, openInput)
    const { width, height } = computeOutputSize(input.setting, sourceSize)
    const audioFormat = await resolveAudioFormat(segments, openInput)

    // 워커에는 document 가 없다. 화면에 붙지 않는 캔버스를 쓴다.
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new ExportError('unknown', '캔버스를 만들 수 없습니다.')

    const isMp4 = input.profile.id === 'mp4-h264-aac'
    const output = new Output({
      format: isMp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target: new BufferTarget(),
    })

    const videoSource = new CanvasSource(canvas, {
      codec: input.profile.videoCodec,
      bitrate: estimateVideoBitrate(input.setting, { width, height }),
    })
    output.addVideoTrack(videoSource, { frameRate: input.setting.fps })

    const audioSource = new AudioSampleSource({
      codec: input.profile.audioCodec,
      bitrate: AUDIO_BITRATE,
    })
    output.addAudioTrack(audioSource)

    await output.start()

    const throwIfAborted = () => {
      if (signal?.aborted) throw new ExportError('canceled')
    }

    for (const segment of segments) {
      throwIfAborted()
      await renderSegment({
        segment,
        input,
        openInput,
        canvas,
        context,
        videoSource,
        audioSource,
        audioFormat,
        throwIfAborted,
        onProgress: () => onProgress?.(segment.end / totalDuration, segment.end),
      })
      onProgress?.(segment.end / totalDuration, segment.end)
    }

    videoSource.close()
    audioSource.close()
    await output.finalize()

    const buffer = output.target.buffer
    if (!buffer) throw new ExportError('unknown', '출력 데이터가 비어 있습니다.')

    const timed = toTimedSubtitles(input.subtitles, input.timeline)

    return {
      buffer,
      mimeType: input.profile.mimeType,
      fileExtension: input.profile.fileExtension,
      srt: timed.length > 0 ? (await import('./srt')).toSrt(timed) : null,
    }
  } catch (error) {
    throw toExportError(error)
  } finally {
    for (const opened of inputs) opened.dispose()
  }
}

/**
 * '원본 유지' 화면비의 기준이 되는 첫 영상의 보이는 크기.
 * 영상이 없으면 16:9 로 본다.
 */
async function resolveSourceSize(
  segments: Segment[],
  openInput: (sourceId: string) => Input,
): Promise<{ width: number; height: number }> {
  for (const segment of segments) {
    if (segment.item.type !== 'video' || !segment.item.sourceId) continue
    const track = await openInput(segment.item.sourceId).getPrimaryVideoTrack()
    if (!track) continue
    return { width: track.displayWidth, height: track.displayHeight }
  }
  return { width: 1280, height: 720 }
}

/** 첫 오디오 트랙의 형식을 출력 기준으로 삼는다. 없으면 기본값. */
async function resolveAudioFormat(
  segments: Segment[],
  openInput: (sourceId: string) => Input,
): Promise<AudioFormat> {
  for (const segment of segments) {
    if (segment.item.type !== 'video' || !segment.item.sourceId) continue
    const track = await openInput(segment.item.sourceId).getPrimaryAudioTrack()
    if (!track) continue
    return {
      sampleRate: await track.getSampleRate(),
      numberOfChannels: await track.getNumberOfChannels(),
    }
  }
  return { sampleRate: FALLBACK_SAMPLE_RATE, numberOfChannels: FALLBACK_CHANNELS }
}

interface RenderContext {
  segment: Segment
  input: ComposeInput
  openInput: (sourceId: string) => Input
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  videoSource: CanvasSource
  audioSource: AudioSampleSource
  audioFormat: AudioFormat
  throwIfAborted: () => void
  onProgress: () => void
}

async function renderSegment(ctx: RenderContext): Promise<void> {
  if (ctx.segment.item.type === 'video') {
    await renderVideoSegment(ctx)
  } else {
    await renderStillSegment(ctx)
  }
}

async function renderVideoSegment(ctx: RenderContext): Promise<void> {
  const { segment, audioSource } = ctx
  const item = segment.item
  if (!item.sourceId) return

  const source = ctx.openInput(item.sourceId)
  const videoTrack = await source.getPrimaryVideoTrack()
  if (!videoTrack) throw new ExportError('no-video-track')

  await drawVideoFrames({ ctx, videoTrack, segment })

  const audioTrack = await source.getPrimaryAudioTrack()
  if (audioTrack && !item.muted) {
    await copyAudio({ ctx, audioTrack, segment })
  } else {
    // 음소거했거나 소리가 없는 영상이라도 그 길이만큼 무음을 채운다.
    // 비우면 뒤 구간의 소리가 앞으로 당겨져 영상과 어긋난다 (AC-013).
    await writeSilence(audioSource, ctx.audioFormat, segment.start, segment.end - segment.start)
  }
}

async function drawVideoFrames({
  ctx,
  videoTrack,
  segment,
}: {
  ctx: RenderContext
  videoTrack: InputVideoTrack
  segment: Segment
}): Promise<void> {
  const item = segment.item
  const sink = new VideoSampleSink(videoTrack)
  const segmentLength = segment.end - segment.start

  let emitted = 0
  for await (const sample of sink.samples(item.inPoint, item.outPoint)) {
    ctx.throwIfAborted()

    // 구간 시작 전에 끝나는 프레임은 버린다. 남기면 출력 시각이 뒤로 가서
    // 먹싱이 깨진다.
    const sampleEnd = sample.timestamp + sample.duration
    if (sampleEnd <= item.inPoint) {
      sample.close()
      continue
    }

    const offset = Math.max(0, sample.timestamp - item.inPoint)
    const timestamp = segment.start + offset
    const duration = Math.min(
      Math.max(sample.duration, 1 / 60),
      segment.end - timestamp,
    )
    if (duration <= 0) {
      sample.close()
      continue
    }

    ctx.context.fillStyle = '#000000'
    ctx.context.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    // 여백 채우기(contain) 또는 잘라 채우기(cover). 회전도 함께 처리된다 (FR-015).
    sample.drawWithFit(ctx.context, { fit: ctx.input.setting.fitMode })
    sample.close()

    paintSubtitle(ctx, segment, item.inPoint + offset)
    await ctx.videoSource.add(timestamp, duration)
    emitted += 1
    ctx.onProgress()
  }

  // 디코딩된 프레임이 하나도 없으면 영상이 통째로 비어 버린다. 최소 한 장은 남긴다.
  if (emitted === 0) {
    ctx.context.fillStyle = '#000000'
    ctx.context.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    paintSubtitle(ctx, segment, item.inPoint)
    await ctx.videoSource.add(segment.start, segmentLength)
  }
}

async function renderStillSegment(ctx: RenderContext): Promise<void> {
  const { segment, input } = ctx
  const item = segment.item
  const length = segment.end - segment.start

  let bitmap: ImageBitmap | null = null
  if (item.type === 'image' && item.sourceId) {
    const file = input.files.get(item.sourceId)
    if (file) bitmap = await createImageBitmap(file)
  }

  const frameCount = Math.max(1, Math.ceil(length * STILL_FPS))
  const frameDuration = length / frameCount

  for (let index = 0; index < frameCount; index += 1) {
    ctx.throwIfAborted()
    const offset = index * frameDuration

    ctx.context.fillStyle = item.type === 'blank' ? item.color : '#000000'
    ctx.context.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    if (bitmap) {
      drawWithFit(ctx.context, bitmap, ctx.canvas.width, ctx.canvas.height, ctx.input.setting.fitMode)
    }
    paintSubtitle(ctx, segment, offset)

    await ctx.videoSource.add(segment.start + offset, frameDuration)
    ctx.onProgress()
  }

  bitmap?.close()

  // 사진과 빈 화면은 소리가 없다. 길이만큼 무음을 넣어 뒤 구간을 밀지 않는다.
  await writeSilence(ctx.audioSource, ctx.audioFormat, segment.start, length)
}

/** 사진을 여백 채우기 또는 잘라 채우기로 그린다. 영상 쪽 drawWithFit 과 같은 규칙이다. */
function drawWithFit(
  context: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  fit: 'contain' | 'cover',
): void {
  const scale =
    fit === 'cover'
      ? Math.max(width / bitmap.width, height / bitmap.height)
      : Math.min(width / bitmap.width, height / bitmap.height)
  const drawWidth = bitmap.width * scale
  const drawHeight = bitmap.height * scale
  context.drawImage(
    bitmap,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
}

/** 그 시점에 보여야 할 자막을 프레임에 새긴다. */
function paintSubtitle(ctx: RenderContext, segment: Segment, sourceTime: number): void {
  const subtitle = subtitleAt(ctx.input.subtitles, segment.item, sourceTime)
  if (!subtitle) return
  drawSubtitle(
    ctx.context,
    subtitle.text,
    ctx.input.subtitleStyle,
    ctx.canvas.width,
    ctx.canvas.height,
  )
}

async function copyAudio({
  ctx,
  audioTrack,
  segment,
}: {
  ctx: RenderContext
  audioTrack: InputAudioTrack
  segment: Segment
}): Promise<void> {
  const item = segment.item
  const sink = new AudioSampleSink(audioTrack)
  let wrote = false

  for await (const sample of sink.samples(item.inPoint, item.outPoint)) {
    ctx.throwIfAborted()

    if (sample.timestamp + sample.duration <= item.inPoint) {
      sample.close()
      continue
    }

    const offset = Math.max(0, sample.timestamp - item.inPoint)
    const normalized = normalizeAudio(sample, ctx.audioFormat, item.volume)
    sample.close()
    normalized.setTimestamp(segment.start + offset)
    await ctx.audioSource.add(normalized)
    normalized.close()
    wrote = true
  }

  if (!wrote) {
    await writeSilence(ctx.audioSource, ctx.audioFormat, segment.start, segment.end - segment.start)
  }
}

/**
 * 샘플을 출력 형식으로 맞추고 볼륨을 적용한다.
 *
 * 채널 수와 샘플레이트를 한 가지로 통일해야 소스가 샘플을 받아 준다.
 * 볼륨은 PCM 을 직접 곱하므로, HTMLMediaElement 가 못 내는 100% 초과도
 * 결과물에서는 실제로 커진다. 넘치는 값은 잘라 잡음을 막는다.
 *
 * 샘플레이트가 다를 때는 선형 보간으로 맞춘다. 대부분의 카메라·휴대폰이
 * 44.1kHz 또는 48kHz 를 쓰므로 변환 폭이 좁고, 이 정도면 귀로 구분되지 않는다.
 */
function normalizeAudio(sample: AudioSample, format: AudioFormat, gain: number): AudioSample {
  const sourceChannels = sample.numberOfChannels
  const sourceFrames = sample.numberOfFrames
  const size = sample.allocationSize({ planeIndex: 0, format: 'f32' })
  const source = new Float32Array(size / Float32Array.BYTES_PER_ELEMENT)
  sample.copyTo(source, { planeIndex: 0, format: 'f32' })

  const ratio = format.sampleRate / sample.sampleRate
  const targetFrames = Math.max(1, Math.round(sourceFrames * ratio))
  const target = new Float32Array(targetFrames * format.numberOfChannels)

  for (let frame = 0; frame < targetFrames; frame += 1) {
    const position = frame / ratio
    const lower = Math.min(sourceFrames - 1, Math.floor(position))
    const upper = Math.min(sourceFrames - 1, lower + 1)
    const fraction = position - lower

    for (let channel = 0; channel < format.numberOfChannels; channel += 1) {
      // 모노를 스테레오로 늘릴 때는 같은 소리를 양쪽에 넣는다.
      const sourceChannel = sourceChannels === 1 ? 0 : Math.min(channel, sourceChannels - 1)
      const a = source[lower * sourceChannels + sourceChannel]
      const b = source[upper * sourceChannels + sourceChannel]
      const value = (a + (b - a) * fraction) * gain
      target[frame * format.numberOfChannels + channel] = Math.max(-1, Math.min(1, value))
    }
  }

  return new AudioSample({
    data: target,
    format: 'f32',
    numberOfChannels: format.numberOfChannels,
    sampleRate: format.sampleRate,
    timestamp: sample.timestamp,
  })
}

/** 지정한 길이만큼 무음을 써 넣는다. */
async function writeSilence(
  audioSource: AudioSampleSource,
  format: AudioFormat,
  startTime: number,
  duration: number,
): Promise<void> {
  if (duration <= 0) return

  let written = 0
  while (written < duration) {
    const chunk = Math.min(SILENCE_CHUNK_SECONDS, duration - written)
    const frames = Math.max(1, Math.round(chunk * format.sampleRate))
    const sample = new AudioSample({
      data: new Float32Array(frames * format.numberOfChannels),
      format: 'f32',
      numberOfChannels: format.numberOfChannels,
      sampleRate: format.sampleRate,
      timestamp: startTime + written,
    })
    await audioSource.add(sample)
    sample.close()
    written += frames / format.sampleRate
  }
}

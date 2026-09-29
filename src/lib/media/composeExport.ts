import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeAudio,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny'
import { fadeFactor, fadesOf, toSegments, type Segment } from '../project/playback'
import { subtitleAt } from '../project/subtitles'
import { isAudioOnly, usesSourceTime } from '../project/types'
import type { ExportSetting, Subtitle, SubtitleStyle, TimelineItem } from '../project/types'
import { computeOutputSize, resolveVideoBitrate, AUDIO_BITRATE } from './outputSize'
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

/** 흐린 배경을 그릴 때 원본을 몇 분의 일로 줄여 쓸지 (FR-015). */
const BLUR_DOWNSCALE = 8

export interface ComposeInput {
  timeline: TimelineItem[]
  /** 원본 id → 파일 */
  files: Map<string, File>
  /** 원본 id → 종류 */
  kinds: Map<string, 'video' | 'image' | 'audio'>
  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  setting: ExportSetting
  profile: ExportCodecProfile
  /**
   * 영상 비트레이트를 직접 지정한다. 목표 용량을 못 맞춰 다시 인코딩할 때만
   * 쓴다 (FR-019). 없으면 설정에서 계산한다.
   */
  bitrateOverride?: number
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
  /** 이번에 쓴 영상 비트레이트. 다시 인코딩할 때 기준이 된다. */
  videoBitrate: number
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
  // 음원만 있는 프로젝트는 화면이 없으므로 MP3 로 낸다.
  if (isAudioOnly(input.timeline)) return composeAudioOnly(input, segments, { onProgress, signal })

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

    const blur = input.setting.fitMode === 'blur' ? createBlurLayer(width, height) : null

    const isMp4 = input.profile.id === 'mp4-h264-aac'
    const output = new Output({
      format: isMp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target: new BufferTarget(),
    })

    const videoBitrate =
      input.bitrateOverride ?? resolveVideoBitrate(input.setting, { width, height }, totalDuration)
    const videoSource = new CanvasSource(canvas, {
      codec: input.profile.videoCodec,
      bitrate: videoBitrate,
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
        blur,
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
      videoBitrate,
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
    if (!usesSourceTime(segment.item) || !segment.item.sourceId) continue
    const track = await openInput(segment.item.sourceId).getPrimaryAudioTrack()
    if (!track) continue
    return {
      sampleRate: await track.getSampleRate(),
      numberOfChannels: await track.getNumberOfChannels(),
    }
  }
  return { sampleRate: FALLBACK_SAMPLE_RATE, numberOfChannels: FALLBACK_CHANNELS }
}

/** 소리만 옮길 때 필요한 것. 음원 전용 내보내기는 화면 쪽 값 없이 이것만 채운다. */
interface AudioRenderContext {
  segment: Segment
  input: ComposeInput
  openInput: (sourceId: string) => Input
  audioSource: AudioSampleSource
  audioFormat: AudioFormat
  throwIfAborted: () => void
}

interface RenderContext extends AudioRenderContext {
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  /** '흐린 배경 채우기'일 때만 있다 */
  blur: BlurLayer | null
  videoSource: CanvasSource
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
  const { segment } = ctx
  const item = segment.item
  if (!item.sourceId) return

  const source = ctx.openInput(item.sourceId)
  const videoTrack = await source.getPrimaryVideoTrack()
  if (!videoTrack) throw new ExportError('no-video-track')

  await drawVideoFrames({ ctx, videoTrack, segment })
  await renderSegmentAudio(ctx)
}

/** 구간의 소리를 옮긴다. 소리가 없거나 음소거면 같은 길이의 무음으로 채운다. */
async function renderSegmentAudio(ctx: AudioRenderContext): Promise<void> {
  const { segment, audioSource } = ctx
  const item = segment.item
  const audioTrack = item.sourceId
    ? await ctx.openInput(item.sourceId).getPrimaryAudioTrack()
    : null
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
    const duration = Math.min(Math.max(sample.duration, 1 / 60), segment.end - timestamp)
    if (duration <= 0) {
      sample.close()
      continue
    }

    ctx.context.fillStyle = '#000000'
    ctx.context.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    // 여백·잘라·흐린 배경 채우기. 회전도 drawWithFit 이 함께 처리한다 (FR-015).
    if (ctx.blur) {
      sample.drawWithFit(ctx.blur.context, { fit: 'cover' })
      paintBlurBackground(ctx.context, ctx.blur, ctx.canvas.width, ctx.canvas.height)
    }
    sample.drawWithFit(ctx.context, { fit: foregroundFit(ctx.input.setting.fitMode) })
    sample.close()

    paintOverlays(ctx, segment, item.inPoint + offset, offset)
    await ctx.videoSource.add(timestamp, duration)
    emitted += 1
    ctx.onProgress()
  }

  // 디코딩된 프레임이 하나도 없으면 영상이 통째로 비어 버린다. 최소 한 장은 남긴다.
  if (emitted === 0) {
    ctx.context.fillStyle = '#000000'
    ctx.context.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    paintOverlays(ctx, segment, item.inPoint, 0)
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
      if (ctx.blur) {
        drawWithFit(
          ctx.blur.context,
          bitmap,
          ctx.blur.canvas.width,
          ctx.blur.canvas.height,
          'cover',
        )
        paintBlurBackground(ctx.context, ctx.blur, ctx.canvas.width, ctx.canvas.height)
      }
      drawWithFit(
        ctx.context,
        bitmap,
        ctx.canvas.width,
        ctx.canvas.height,
        foregroundFit(ctx.input.setting.fitMode),
      )
    }
    paintOverlays(ctx, segment, offset, offset)

    await ctx.videoSource.add(segment.start + offset, frameDuration)
    ctx.onProgress()
  }

  bitmap?.close()

  // 영상과 섞인 음원 구간은 검은 화면 위에 소리만 흐른다.
  if (item.type === 'audio') {
    await renderSegmentAudio(ctx)
    return
  }
  // 사진과 빈 화면은 소리가 없다. 길이만큼 무음을 넣어 뒤 구간을 밀지 않는다.
  await writeSilence(ctx.audioSource, ctx.audioFormat, segment.start, length)
}

interface BlurLayer {
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  radius: number
  /** 블러가 캔버스 밖을 물어 가장자리가 어두워지는 것을 막는 여유 */
  margin: number
}

/** 흐린 배경용 작은 캔버스. 크게 잡으면 프레임마다 블러가 느려진다. */
function createBlurLayer(width: number, height: number): BlurLayer | null {
  const canvas = new OffscreenCanvas(
    Math.max(16, Math.round(width / BLUR_DOWNSCALE)),
    Math.max(16, Math.round(height / BLUR_DOWNSCALE)),
  )
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return null
  const radius = Math.max(6, Math.round(height / 45))
  return { canvas, context, radius, margin: radius * 2 }
}

/**
 * 남는 자리를 원본을 흐리게 키운 것으로 채운다 (FR-015).
 *
 * 세로 영상을 가로 화면비로 내보낼 때 검은 여백보다 자연스럽고, 잘라 채우기와
 * 달리 화면이 잘리지 않는다.
 *
 * 1/8 로 줄인 캔버스에 잘라 채우기로 그린 뒤 다시 키운다. 줄였다 키우는 것만으로
 * 이미 흐려지므로, 큰 캔버스에 블러를 거는 것보다 훨씬 빠르고 결과는 비슷하다.
 * `filter` 를 지원하지 않는 브라우저에서는 확대로 인한 흐림만 남는다.
 */
function paintBlurBackground(
  context: OffscreenCanvasRenderingContext2D,
  layer: BlurLayer,
  width: number,
  height: number,
): void {
  context.save()
  context.filter = `blur(${layer.radius}px)`
  context.drawImage(
    layer.canvas,
    -layer.margin,
    -layer.margin,
    width + layer.margin * 2,
    height + layer.margin * 2,
  )
  context.restore()
}

/** 흐린 배경 채우기는 배경만 다르고 본 화면은 여백 채우기와 같게 그린다. */
function foregroundFit(fit: ExportSetting['fitMode']): 'contain' | 'cover' {
  return fit === 'cover' ? 'cover' : 'contain'
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

/**
 * 그 시점의 자막과 페이드를 프레임에 새긴다.
 *
 * 페이드는 자막까지 덮도록 맨 마지막에 검정을 얹는다. 화면만 어두워지고
 * 자막이 또렷이 남으면 페이드가 어색해 보인다.
 */
function paintOverlays(
  ctx: RenderContext,
  segment: Segment,
  sourceTime: number,
  clipOffset: number,
): void {
  const subtitle = subtitleAt(ctx.input.subtitles, segment.item, sourceTime)
  if (subtitle) {
    drawSubtitle(
      ctx.context,
      subtitle.text,
      ctx.input.subtitleStyle,
      ctx.canvas.width,
      ctx.canvas.height,
    )
  }

  const factor = fadeFactor(segment.item, clipOffset)
  if (factor < 1) {
    ctx.context.fillStyle = `rgba(0, 0, 0, ${1 - factor})`
    ctx.context.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  }
}

async function copyAudio({
  ctx,
  audioTrack,
  segment,
}: {
  ctx: AudioRenderContext
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
    const normalized = normalizeAudio(sample, ctx.audioFormat, item, offset)
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
 * 볼륨과 페이드는 PCM 을 직접 곱하므로, HTMLMediaElement 가 못 내는 100% 초과도
 * 결과물에서는 실제로 커진다. 넘치는 값은 잘라 잡음을 막는다.
 *
 * 샘플레이트가 다를 때는 선형 보간으로 맞춘다. 대부분의 카메라·휴대폰이
 * 44.1kHz 또는 48kHz 를 쓰므로 변환 폭이 좁고, 이 정도면 귀로 구분되지 않는다.
 */
function normalizeAudio(
  sample: AudioSample,
  format: AudioFormat,
  item: TimelineItem,
  /** 이 샘플이 시작하는 곳의 클립 안 시각(초). 페이드 곡선의 기준이다. */
  clipOffset: number,
): AudioSample {
  const fades = fadesOf(item)
  const fading = fades.fadeIn > 0 || fades.fadeOut > 0
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
    // 샘플 하나 안에서도 프레임마다 배율을 구해야 페이드가 계단 없이 이어진다.
    const gain = fading
      ? item.volume * fadeFactor(item, clipOffset + frame / format.sampleRate)
      : item.volume

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

/** MP3 가 받는 샘플레이트. 그 밖의 값이면 44.1kHz 로 바꿔 쓴다. */
const MP3_SAMPLE_RATES = [48000, 44100, 32000, 24000, 22050, 16000]
const MP3_BITRATE = 192_000

/**
 * 음원만 이어 붙여 MP3 로 내보낸다.
 *
 * 영상 쪽과 같은 소리 경로(구간 순회·정규화·볼륨·페이드)를 쓴다. 화면 캔버스와
 * 영상 트랙만 빠진다. 브라우저에 MP3 인코더가 없을 수 있어(WebCodecs 는 MP3 를
 * 인코딩하지 않는다) LAME 인코더를 필요할 때만 받아 등록한다.
 */
async function composeAudioOnly(
  input: ComposeInput,
  segments: Segment[],
  { onProgress, signal }: ComposeOptions,
): Promise<ComposeResult> {
  const totalDuration = segments.at(-1)?.end ?? 0
  const inputs: Input[] = []

  try {
    if (!(await canEncodeAudio('mp3'))) {
      const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder')
      registerMp3Encoder()
    }

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

    const detected = await resolveAudioFormat(segments, openInput)
    const audioFormat: AudioFormat = {
      sampleRate: MP3_SAMPLE_RATES.includes(detected.sampleRate) ? detected.sampleRate : 44100,
      numberOfChannels: Math.min(2, detected.numberOfChannels),
    }

    const output = new Output({ format: new Mp3OutputFormat(), target: new BufferTarget() })
    const audioSource = new AudioSampleSource({ codec: 'mp3', bitrate: MP3_BITRATE })
    output.addAudioTrack(audioSource)
    await output.start()

    for (const segment of segments) {
      if (signal?.aborted) throw new ExportError('canceled')
      await renderSegmentAudio({
        segment,
        input,
        openInput,
        audioSource,
        audioFormat,
        throwIfAborted: () => {
          if (signal?.aborted) throw new ExportError('canceled')
        },
      })
      onProgress?.(segment.end / totalDuration, segment.end)
    }

    audioSource.close()
    await output.finalize()

    const buffer = output.target.buffer
    if (!buffer) throw new ExportError('unknown', '출력 데이터가 비어 있습니다.')

    return { buffer, mimeType: 'audio/mpeg', fileExtension: 'mp3', srt: null, videoBitrate: 0 }
  } catch (error) {
    throw toExportError(error)
  } finally {
    for (const opened of inputs) opened.dispose()
  }
}

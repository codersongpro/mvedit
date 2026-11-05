import type { SubtitleWord } from '../project/types'

/**
 * Whisper 가 낸 문장 덩어리를 화면에 올릴 자막 줄로 바꾼다 (FR-039).
 *
 * Whisper 의 한 덩어리는 길게는 수십 초, 수십 글자다. 그대로 올리면 화면을
 * 덮고 읽을 시간도 모자라서 짧은 줄로 다시 나눈다.
 */

export interface AsrChunk {
  text: string
  /** 덩어리 시작부터의 초. 끝을 모르면 null */
  timestamp: [number, number | null]
}

export interface CaptionLine {
  start: number
  end: number
  text: string
  words: SubtitleWord[]
}

/** 한 줄 최대 글자 수. 휴대폰 세로 화면에서도 두 줄 안에 들어오는 길이다. */
export const MAX_LINE_CHARS = 24

/**
 * 이보다 조용한 구간의 인식 결과는 버린다.
 *
 * Whisper 는 무음이나 잡음에서도 "시청해 주셔서 감사합니다" 같은 문장을
 * 지어내는 버릇이 있다. 학습 데이터의 영상 끝인사가 섞여 있어서다.
 * 실제 말소리의 RMS 는 보통 0.03 이상이고 실내 잡음은 0.005 안팎이다.
 */
export const SILENCE_RMS = 0.01

/**
 * 단어별 시각을 글자 수에 비례해 나눈다.
 *
 * 단어 단위 타임스탬프를 내는 모델은 따로 있지만 종류가 적고 크다. 덩어리
 * 시각을 글자 수로 나누면 말 속도가 고른 일상 대화에서는 하이라이트가 눈에
 * 띄게 어긋나지 않는다.
 */
export function splitWords(text: string, start: number, end: number): SubtitleWord[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  const weights = tokens.map((token) => Math.max(1, [...token].length))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const span = Math.max(0, end - start)
  const words: SubtitleWord[] = []
  let cursor = start
  tokens.forEach((token, index) => {
    const length = (span * weights[index]) / total
    words.push({ text: token, start: cursor, end: cursor + length })
    cursor += length
  })
  return words
}

/** 단어를 줄 길이에 맞춰 묶는다. 단어 중간에서는 자르지 않는다. */
export function groupLines(words: SubtitleWord[], maxChars = MAX_LINE_CHARS): CaptionLine[] {
  const lines: CaptionLine[] = []
  let current: SubtitleWord[] = []
  const flush = () => {
    if (current.length === 0) return
    lines.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((word) => word.text).join(' '),
      words: current,
    })
    current = []
  }
  for (const word of words) {
    const length =
      current.reduce((sum, w) => sum + [...w.text].length + 1, 0) + [...word.text].length
    if (current.length > 0 && length > maxChars) flush()
    current.push(word)
    // 문장이 끝나면 글자 수가 남아도 줄을 바꾼다. 다음 문장과 섞이면 읽기 어렵다.
    if (/[.?!。？！]$/.test(word.text)) flush()
  }
  flush()
  return lines
}

/** 구간의 소리 크기(RMS). 16kHz 모노 PCM 을 받는다. */
export function rmsOf(pcm: Float32Array, sampleRate: number, start: number, end: number): number {
  const from = Math.max(0, Math.floor(start * sampleRate))
  const to = Math.min(pcm.length, Math.ceil(end * sampleRate))
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i += 1) sum += pcm[i] * pcm[i]
  return Math.sqrt(sum / (to - from))
}

/**
 * 한 창(window)의 인식 결과를 자막 줄로 바꾼다.
 *
 * `offset` 은 창이 원본 시간축에서 시작하는 곳, `windowStart` 는 창이 pcm 안에서
 * 시작하는 곳(초)이다.
 */
export function chunksToLines({
  chunks,
  pcm,
  sampleRate,
  windowStart,
  windowEnd,
  offset,
}: {
  chunks: AsrChunk[]
  pcm: Float32Array
  sampleRate: number
  windowStart: number
  windowEnd: number
  offset: number
}): CaptionLine[] {
  const lines: CaptionLine[] = []
  for (const chunk of chunks) {
    const text = chunk.text.trim()
    // 괄호 안 효과음 표기([음악], (박수))는 말이 아니라서 자막으로 올리지 않는다.
    if (!text || /^[[(（].*[\])）]$/.test(text)) continue
    const start = windowStart + Math.max(0, chunk.timestamp[0])
    const end = Math.min(windowEnd, windowStart + (chunk.timestamp[1] ?? windowEnd - windowStart))
    if (end <= start) continue
    if (rmsOf(pcm, sampleRate, start, end) < SILENCE_RMS) continue
    const words = splitWords(text, offset + start, offset + end)
    lines.push(...groupLines(words))
  }
  return lines
}

/**
 * 긴 소리를 30초 이하 창으로 나눈다. 경계는 끝부분 몇 초 안에서 가장 조용한
 * 곳으로 옮긴다. 말 한가운데서 자르면 그 단어가 양쪽에서 모두 틀리게 나온다.
 */
export function planWindows(
  pcm: Float32Array,
  sampleRate: number,
  maxSeconds = 28,
): [number, number][] {
  const duration = pcm.length / sampleRate
  const windows: [number, number][] = []
  const search = 4
  const frame = 0.1
  let start = 0
  while (duration - start > maxSeconds) {
    const limit = start + maxSeconds
    let best = limit
    let bestRms = Infinity
    for (let t = limit - search; t + frame <= limit; t += frame) {
      const rms = rmsOf(pcm, sampleRate, t, t + frame)
      if (rms < bestRms) {
        bestRms = rms
        best = t + frame / 2
      }
    }
    windows.push([start, best])
    start = best
  }
  if (duration - start > 0.05) windows.push([start, duration])
  return windows
}

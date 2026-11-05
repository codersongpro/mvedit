import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'

/** Whisper 가 받는 형식 */
export const ASR_SAMPLE_RATE = 16000

/**
 * 원본 파일의 [start, end) 구간 소리를 16kHz 모노 PCM 으로 꺼낸다.
 *
 * 파일 전체를 decodeAudioData 로 읽으면 1GB 영상이 통째로 메모리에 올라간다.
 * 그래서 필요한 구간만 샘플 단위로 흘려 받으며 바로 줄인다.
 *
 * 샘플레이트 변환은 출력 한 칸에 들어오는 원본 값을 평균 낸다. 48kHz→16kHz
 * 처럼 줄이는 쪽에서는 이것이 간단한 저역 통과 필터 노릇을 해 접힘 잡음이
 * 줄어든다. 음성 인식에는 이 정도면 충분하다.
 */
export async function extractSpeechPcm(
  file: File,
  start: number,
  end: number,
): Promise<Float32Array | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null

    const length = Math.max(1, Math.ceil((end - start) * ASR_SAMPLE_RATE))
    const sum = new Float32Array(length)
    const count = new Uint16Array(length)
    const sink = new AudioSampleSink(track)

    for await (const sample of sink.samples(start, end)) {
      const channels = sample.numberOfChannels
      const frames = sample.numberOfFrames
      const data = new Float32Array(
        sample.allocationSize({ planeIndex: 0, format: 'f32' }) / Float32Array.BYTES_PER_ELEMENT,
      )
      sample.copyTo(data, { planeIndex: 0, format: 'f32' })
      const rate = sample.sampleRate
      const base = sample.timestamp - start
      sample.close()

      for (let frame = 0; frame < frames; frame += 1) {
        const index = Math.floor((base + frame / rate) * ASR_SAMPLE_RATE)
        if (index < 0 || index >= length) continue
        let mono = 0
        for (let channel = 0; channel < channels; channel += 1) {
          mono += data[frame * channels + channel]
        }
        sum[index] += mono / channels
        if (count[index] < 65535) count[index] += 1
      }
    }

    // 원본이 16kHz 보다 낮으면 빈 칸이 생긴다. 앞 값을 이어 써서 끊김을 막는다.
    let previous = 0
    for (let i = 0; i < length; i += 1) {
      if (count[i] > 0) previous = sum[i] / count[i]
      sum[i] = previous
    }
    return sum
  } finally {
    input.dispose()
  }
}

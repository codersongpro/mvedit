/**
 * 브라우저 안에서 시험용 영상 파일을 만든다.
 *
 * Node에는 WebCodecs가 없어 픽스처를 서버 쪽에서 만들 수 없다. 그래서
 * mediabunny 번들을 blob으로 주입해 페이지 안에서 인코딩한다.
 * 이 코드는 제품 번들에 포함되지 않는다.
 */
export async function buildFixture({
  bundleSource,
  widthPx,
  heightPx,
  durationSec,
  fps,
  rotation = 0,
  pattern = 'plain',
}) {
  const url = URL.createObjectURL(new Blob([bundleSource], { type: 'text/javascript' }))
  const mb = await import(/* @vite-ignore */ url)

  // 컨테이너 Chromium은 H.264·AAC 인코딩이 없으므로 가능한 조합을 고른다.
  const videoCodec = (await mb.canEncodeVideo('avc')) ? 'avc' : 'vp9'
  const audioCodec = (await mb.canEncodeAudio('aac')) ? 'aac' : 'opus'
  const isMp4 = videoCodec === 'avc' && audioCodec === 'aac'

  const output = new mb.Output({
    format: isMp4 ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  })

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')

  const videoSource = new mb.CanvasSource(canvas, { codec: videoCodec, bitrate: 1_000_000 })
  // rotation 을 주면 폰 세로 촬영 영상처럼 "픽셀은 가로, 메타데이터로 회전" 상태가 된다.
  output.addVideoTrack(videoSource, { frameRate: fps, rotation })

  const sampleRate = 48000
  const audioSource = new mb.AudioBufferSource({
    codec: audioCodec,
    bitrate: 128_000,
    sampleRate,
    numberOfChannels: 1,
  })
  output.addAudioTrack(audioSource)

  await output.start()

  // 프레임마다 위치가 바뀌는 사각형. 프레임이 실제로 갱신되는지 눈으로 확인 가능하게.
  const frameCount = Math.round(durationSec * fps)
  for (let i = 0; i < frameCount; i += 1) {
    ctx.fillStyle = '#101820'
    ctx.fillRect(0, 0, widthPx, heightPx)
    // 'checker' 는 촘촘한 격자를 깔아 화면 전체에 잔 무늬를 만든다. 흐리게
    // 처리했는지 재려면 원본이 선명해야 한다. 평평한 배경은 흐려도 그대로다.
    if (pattern === 'checker') {
      const cell = 8
      for (let y = 0; y < heightPx; y += cell) {
        for (let x = 0; x < widthPx; x += cell) {
          ctx.fillStyle = ((x / cell + y / cell) | 0) % 2 === 0 ? '#e2e8f0' : '#1e293b'
          ctx.fillRect(x, y, cell, cell)
        }
      }
    }
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect((i / frameCount) * (widthPx - 40), heightPx / 2 - 20, 40, 40)
    ctx.fillStyle = '#ffffff'
    ctx.font = '16px sans-serif'
    ctx.fillText(`frame ${i}`, 8, 20)
    await videoSource.add(i / fps, 1 / fps)
  }
  videoSource.close()

  // 440Hz 사인파. 소리 트랙이 실제로 실려 나가는지 확인하기 위한 최소 신호.
  const audioCtx = new OfflineAudioContext(1, Math.round(sampleRate * durationSec), sampleRate)
  const buffer = audioCtx.createBuffer(1, Math.round(sampleRate * durationSec), sampleRate)
  const channel = buffer.getChannelData(0)
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.25
  }
  await audioSource.add(buffer)
  audioSource.close()

  await output.finalize()
  URL.revokeObjectURL(url)

  return {
    bytes: Array.from(new Uint8Array(output.target.buffer)),
    extension: isMp4 ? 'mp4' : 'webm',
    mimeType: isMp4 ? 'video/mp4' : 'video/webm',
    videoCodec,
    audioCodec,
    rotation,
  }
}

/** 내보낸 결과 파일을 다시 읽어 검사한다. */
export async function inspectFile({ bundleSource, bytes, mimeType }) {
  const url = URL.createObjectURL(new Blob([bundleSource], { type: 'text/javascript' }))
  const mb = await import(/* @vite-ignore */ url)

  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType })
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS })

  const videoTrack = await input.getPrimaryVideoTrack()
  const audioTrack = await input.getPrimaryAudioTrack()

  // 타임스탬프가 뒤로 가면 재생 시 끊기거나 싱크가 어긋난다.
  let previous = -Infinity
  let monotonic = true
  let frameCount = 0
  const sink = new mb.EncodedPacketSink(videoTrack)
  for await (const packet of sink.packets()) {
    if (packet.timestamp < previous) monotonic = false
    previous = packet.timestamp
    frameCount += 1
  }

  // 오디오 길이를 따로 재야 영상과 어긋나는지 볼 수 있다 (AC-013).
  let audioDuration = null
  let audioEnergy = null
  if (audioTrack) {
    audioDuration = await input.computeDuration([audioTrack])
    // 구간별로 소리가 실제로 들어 있는지 본다. 무음 구간은 값이 0에 가깝다.
    const audioSink = new mb.AudioSampleSink(audioTrack)
    const buckets = []
    for await (const sample of audioSink.samples()) {
      const size = sample.allocationSize({ planeIndex: 0, format: 'f32' })
      const pcm = new Float32Array(size / 4)
      sample.copyTo(pcm, { planeIndex: 0, format: 'f32' })
      let peak = 0
      for (let i = 0; i < pcm.length; i += 1) peak = Math.max(peak, Math.abs(pcm[i]))
      buckets.push({ t: sample.timestamp, peak })
      sample.close()
    }
    audioEnergy = buckets
  }

  const result = {
    duration: await input.computeDuration(),
    audioDuration,
    audioEnergy,
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    rotation: await videoTrack.getRotation(),
    videoCodec: videoTrack.codec,
    hasAudio: audioTrack !== null,
    audioCodec: audioTrack?.codec ?? null,
    frameCount,
    monotonic,
  }

  input.dispose()
  URL.revokeObjectURL(url)
  return result
}

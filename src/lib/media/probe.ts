import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'

/**
 * 예외 대신 결과 객체를 돌려준다. 이 모듈은 동적 import로 불러오므로
 * 예외 클래스를 `instanceof`로 판별하는 방식이 번들 경계에서 어긋날 수 있다.
 */
export type ProbeResult =
  | { ok: true; info: MediaInfo }
  | { ok: false; code: 'unreadable' | 'no-video-track' }

export interface MediaInfo {
  fileName: string
  fileSize: number
  durationSeconds: number
  /** 회전을 반영한, 사람이 보게 될 크기 */
  displayWidth: number
  displayHeight: number
  /** 컨테이너에 기록된 회전값(도). 폰 세로 촬영 영상에서 0이 아닌 값이 흔하다. */
  rotation: number
  videoCodec: string | null
  audioCodec: string | null
  hasAudio: boolean
}

/**
 * 영상 파일의 메타데이터를 읽는다.
 *
 * 화면 표시용이자, 내보내기 전에 "이 파일을 다룰 수 있는가"를 판단하는 관문이다.
 * 읽을 수 없는 파일은 여기서 걸러 타임라인에 들어가지 못하게 한다(FR-003).
 */
export async function probeMedia(file: File): Promise<ProbeResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    if (!(await input.canRead())) {
      return { ok: false, code: 'unreadable' }
    }

    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) {
      return { ok: false, code: 'no-video-track' }
    }

    const audioTrack = await input.getPrimaryAudioTrack()

    return {
      ok: true,
      info: {
        fileName: file.name,
        fileSize: file.size,
        durationSeconds: await input.computeDuration(),
        displayWidth: videoTrack.displayWidth,
        displayHeight: videoTrack.displayHeight,
        rotation: await videoTrack.getRotation(),
        videoCodec: videoTrack.codec,
        audioCodec: audioTrack?.codec ?? null,
        hasAudio: audioTrack !== null,
      },
    }
  } catch {
    return { ok: false, code: 'unreadable' }
  } finally {
    input.dispose()
  }
}

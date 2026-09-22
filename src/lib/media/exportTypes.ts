import type { AudioCodec, VideoCodec } from 'mediabunny'
import type { Subtitle, SubtitleStyle, TimelineItem } from '../project/types'

/**
 * 출력 코덱 조합.
 *
 * 제품의 출력은 MP4(H.264/AAC) 하나로 고정이지만(PRD 4절), 코덱을 주입 가능하게
 * 둔 이유는 두 가지다.
 * 1. 개발 컨테이너의 Chromium은 오픈소스 빌드라 H.264·AAC 인코딩이 불가능해
 *    자동 테스트를 VP9/Opus로 돌려야 한다. 파이프라인 코드 경로는 동일하다.
 * 2. Phase 14에서 ffmpeg.wasm 폴백을 끼워 넣을 자리가 된다.
 */
export interface ExportCodecProfile {
  id: 'mp4-h264-aac' | 'webm-vp9-opus'
  label: string
  videoCodec: VideoCodec
  audioCodec: AudioCodec
  fileExtension: string
  mimeType: string
}

export const MP4_PROFILE: ExportCodecProfile = {
  id: 'mp4-h264-aac',
  label: 'MP4 (H.264 / AAC)',
  videoCodec: 'avc',
  audioCodec: 'aac',
  fileExtension: 'mp4',
  mimeType: 'video/mp4',
}

/** 시험·폴백 확인용. 제품 UI에서 기본으로 고르게 하지 않는다. */
export const WEBM_PROFILE: ExportCodecProfile = {
  id: 'webm-vp9-opus',
  label: 'WebM (VP9 / Opus)',
  videoCodec: 'vp9',
  audioCodec: 'opus',
  fileExtension: 'webm',
  mimeType: 'video/webm',
}

export type ExportErrorCode =
  | 'unreadable'
  | 'no-video-track'
  | 'codec-unsupported'
  | 'canceled'
  | 'out-of-memory'
  | 'unknown'

/** 실패 사유별 한국어 안내. 사용자가 다음에 뭘 해야 하는지까지 적는다. */
export const EXPORT_ERROR_MESSAGE: Record<ExportErrorCode, string> = {
  unreadable: '이 파일을 읽을 수 없습니다. 이 브라우저가 지원하지 않는 형식이거나 파일이 손상되었을 수 있습니다.',
  'no-video-track': '영상 트랙이 없는 파일입니다. 소리만 있는 파일은 아직 지원하지 않습니다.',
  'codec-unsupported': '이 기기에서 내보내기에 필요한 코덱을 지원하지 않습니다. 다른 브라우저에서 열어 보세요.',
  canceled: '내보내기를 취소했습니다.',
  'out-of-memory': '메모리가 부족합니다. 해상도를 낮추거나 더 짧은 영상으로 나눠 내보내 주세요.',
  unknown: '내보내는 중 문제가 발생했습니다.',
}

/** 워커로 넘기는 프로젝트. File 과 평범한 객체만 담아 구조화 복제가 되게 한다. */
export interface ExportJob {
  timeline: TimelineItem[]
  /** 원본 id → 파일 */
  files: Array<[string, File]>
  /** 원본 id → 종류 */
  kinds: Array<[string, 'video' | 'image']>
  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  profile: ExportCodecProfile
}

export type ExportWorkerRequest = { type: 'start'; job: ExportJob } | { type: 'cancel' }

export type ExportWorkerResponse =
  | { type: 'progress'; progress: number; processedTime: number }
  | {
      type: 'done'
      buffer: ArrayBuffer
      mimeType: string
      fileExtension: string
      /** 자막이 있을 때만 채워진다 */
      srt: string | null
    }
  | { type: 'error'; code: ExportErrorCode; message: string }

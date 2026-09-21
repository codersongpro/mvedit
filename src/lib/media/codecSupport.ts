import {
  MP4_PROFILE,
  WEBM_PROFILE,
  type ExportCodecProfile,
} from './exportTypes'

/**
 * 이 기기에서 실제로 인코딩 가능한 조합을 고른다.
 *
 * mediabunny를 동적으로 불러오는 이유: 정적으로 import하면 인코딩 코드 전체가
 * 첫 화면 번들에 들어가 초기 로딩이 300KB 이상 무거워진다. 코덱 확인과 내보내기는
 * 첫 화면 렌더 이후에 필요하므로 그때 받아온다. (PRD 11절 최초 로딩 기준)
 */
export async function pickSupportedProfile(): Promise<ExportCodecProfile | null> {
  const { canEncodeAudio, canEncodeVideo } = await import('mediabunny')

  for (const profile of [MP4_PROFILE, WEBM_PROFILE]) {
    const [video, audio] = await Promise.all([
      canEncodeVideo(profile.videoCodec),
      canEncodeAudio(profile.audioCodec),
    ])
    if (video && audio) return profile
  }
  return null
}

/** 진단 화면용. MP4를 만들 수 있는지 영상·소리 코덱을 따로 알려준다. */
export async function probeMp4Codecs(): Promise<{ h264: boolean; aac: boolean }> {
  try {
    const { canEncodeAudio, canEncodeVideo } = await import('mediabunny')
    const [h264, aac] = await Promise.all([canEncodeVideo('avc'), canEncodeAudio('aac')])
    return { h264, aac }
  } catch {
    return { h264: false, aac: false }
  }
}

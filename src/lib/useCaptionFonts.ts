import { useEffect } from 'react'
import { useProject } from './project/store'
import { fontOf } from './media/subtitleLook'
import { registerCaptionFont } from './media/captionFonts'

/**
 * 자막에 쓰인 글꼴을 문서에 등록한다 (FR-050).
 *
 * 쓰는 글꼴만 등록한다. 12종을 다 등록하면 고르지도 않은 글꼴의 조각 목록까지
 * 받게 된다. Pretendard 는 앱 화면 CSS 가 이미 선언했다.
 */
export function useCaptionFonts(): void {
  const subtitles = useProject((state) => state.subtitles)
  const style = useProject((state) => state.subtitleStyle)
  useEffect(() => {
    const ids = new Set([style.font, ...subtitles.map((subtitle) => fontOf(subtitle, style))])
    for (const id of ids) {
      if (!id) continue
      void registerCaptionFont(document.fonts, id, {
        origin: location.origin,
        skipPretendard: true,
      }).catch(() => {})
    }
  }, [subtitles, style])
}

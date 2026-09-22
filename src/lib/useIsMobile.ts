import { useEffect, useState } from 'react'

/**
 * 모바일 세로 레이아웃을 쓸지 (PRD 6절, FR-029).
 *
 * 기기 종류가 아니라 화면 폭으로 정한다. 사용자 에이전트로 가르면 태블릿과
 * 접는 폰에서 틀리고, 창을 좁힌 데스크톱에서는 좁은 화면 그대로 데스크톱
 * 배치가 남는다.
 */
const MOBILE_QUERY = '(max-width: 767px)'

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return mobile
}

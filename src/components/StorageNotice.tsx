import { useEffect, useState } from 'react'
import { useProject } from '../lib/project/store'
import { btn } from './m3'

/** 한 번 닫으면 다시 띄우지 않는다. 같은 말을 매번 하면 읽지 않게 된다. */
const SEEN_KEY = 'cutcap.ios-storage-notice'

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // 아이패드는 최근 사파리에서 자신을 맥으로 소개한다. 터치 지원으로 가른다.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || iPadOS
}

function alreadyStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const legacy = (navigator as { standalone?: boolean }).standalone === true
  return legacy || window.matchMedia('(display-mode: standalone)').matches
}

/**
 * iOS 저장소 고지 (FR-027, AC-031).
 *
 * iOS 사파리는 7일 넘게 쓰지 않은 사이트의 저장 데이터를 지운다. 자동
 * 저장만 믿고 있다가 작업을 잃는 일이 생기므로, 처음 저장되는 시점에
 * 한 번 알리고 확실한 방법 두 가지를 같이 준다.
 */
export function StorageNotice() {
  const projectId = useProject((state) => state.projectId)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (!projectId || !isIOS() || alreadyStandalone()) return
    try {
      if (localStorage.getItem(SEEN_KEY) === 'yes') return
    } catch {
      // 저장소를 막아 둔 브라우저. 고지는 띄우되 기억하지 못할 뿐이다.
    }
    setDismissed(false)
  }, [projectId])

  if (dismissed) return null

  const close = () => {
    setDismissed(true)
    try {
      localStorage.setItem(SEEN_KEY, 'yes')
    } catch {
      /* 기억하지 못해도 이번 화면에서는 닫힌다 */
    }
  }

  return (
    <aside
      data-testid="ios-storage-notice"
      className="flex flex-col gap-2 rounded-m3-md bg-tertiary-container p-4 m3-body-medium text-on-tertiary-container"
    >
      <p className="m3-title-small">아이폰·아이패드에서 읽어 주세요</p>
      <p>
        사파리는 <strong>7일 넘게 이 사이트를 열지 않으면</strong> 자동 저장된 작업을 지울 수
        있습니다. 오래 두고 쓸 작업이라면 다음 중 하나를 해 두세요.
      </p>
      <ul className="ml-4 list-disc space-y-1">
        <li>
          공유 버튼 <span aria-hidden>􀈂</span> → <strong>홈 화면에 추가</strong>. 앱처럼 열리고
          저장한 작업이 더 오래 남습니다.
        </li>
        <li>
          <strong>‘프로젝트 파일 저장’</strong>으로 편집 내용을 파일로 빼 두기. 파일은 사파리가
          지우지 않습니다.
        </li>
      </ul>
      <button
        type="button"
        data-testid="dismiss-ios-notice"
        onClick={close}
        className={`${btn.filled} mt-1 self-start`}
      >
        알겠습니다
      </button>
    </aside>
  )
}

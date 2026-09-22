import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('루트 요소를 찾을 수 없습니다.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 오프라인 실행 (FR-032). 화면을 먼저 띄운 뒤 등록해 첫 화면을 늦추지 않는다.
// 개발 서버에서는 등록하지 않는다. 캐시가 코드 수정을 덮어 버린다.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 등록에 실패해도 앱은 그대로 쓸 수 있다. 오프라인만 안 될 뿐이다.
    })
  })
}

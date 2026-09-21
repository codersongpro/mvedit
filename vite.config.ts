import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 개발 서버와 프리뷰 서버에도 배포 환경과 동일한 격리 헤더를 내려준다.
// 이 두 헤더가 있어야 crossOriginIsolated가 true가 되고, SharedArrayBuffer를
// 쓰는 ffmpeg.wasm 멀티스레드 경로가 동작한다. (PRD 10절, FR-028)
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
})

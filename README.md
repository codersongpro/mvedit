# MVEdit

설치도 로그인도 없이 브라우저에서 영상을 자르고 이어 붙여, 원하는 용량과 화면비에 맞춰
내보내는 무료 웹 편집기입니다.

**영상 파일은 기기를 벗어나지 않습니다.** 인코딩까지 전부 브라우저 안에서 처리하므로
서버에 업로드되는 것이 없습니다.

## 현재 상태

Phase 1 완료. 지금 화면은 이 기기에서 편집·내보내기가 가능한지 점검하는 진단 화면뿐이며,
타임라인 편집 기능은 다음 페이즈에서 구현합니다. 전체 요구사항은 [PRD.md](./PRD.md)를
참고하세요.

## 로컬 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # 타입 검사 + 프로덕션 빌드
npm run preview  # 빌드 결과 확인
```

## COOP/COEP 헤더가 필요한 이유

이 앱은 `Cross-Origin-Opener-Policy: same-origin` 과
`Cross-Origin-Embedder-Policy: require-corp` 두 헤더를 반드시 내려줘야 합니다.

두 헤더가 있어야 브라우저가 **교차 출처 격리(cross-origin isolation)** 상태가 되고,
그래야 `SharedArrayBuffer` 를 쓸 수 있습니다. WebCodecs를 지원하지 않는 브라우저에서
폴백으로 쓰는 ffmpeg.wasm 이 여러 스레드로 인코딩하려면 이 공유 메모리가 필요합니다.
헤더가 빠지면 인코딩이 단일 스레드로 떨어져 몇 배로 느려집니다.

설정 위치는 두 곳이며 **항상 함께 수정해야 합니다.**

- `vercel.json` — 배포 환경
- `vite.config.ts` 의 `server.headers` / `preview.headers` — 로컬 개발·프리뷰

이 제약 때문에 외부 CDN 스크립트와 웹폰트를 쓸 수 없습니다. 모든 자산은 자체 호스팅합니다.

## 배포

`main` 브랜치에 푸시하면 Vercel이 프로덕션으로 배포합니다.

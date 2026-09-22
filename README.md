# CutCap

설치도 로그인도 없이 브라우저에서 영상을 자르고 이어 붙여, 원하는 용량과 화면비에 맞춰
내보내는 웹 편집기입니다.

**영상 파일은 기기를 벗어나지 않습니다.** 인코딩까지 전부 브라우저 안에서 처리하므로
서버에 업로드되는 것이 없습니다.

## 현재 상태

Phase 14까지 완료. 파일 불러오기, 타임라인 편집(자르기·트림·지우기·순서·되돌리기),
빈 화면·이미지 클립, 볼륨·음소거, 미리보기 재생, 자막 입력·굽기·`.srt` 내보내기,
화면비·해상도·화질·목표 용량 설정, 자동 저장·복원, `.cutcap` 프로젝트 파일,
모바일 세로 레이아웃, 홈 화면 설치·오프라인 실행까지 동작합니다.

남은 것: 성능·저사양 기기 검증(15).
전체 요구사항과 단계 표는 [PRD.md](./PRD.md)를 참고하세요.

## 로컬 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # 타입 검사 + 프로덕션 빌드
npm run preview  # 빌드 결과 확인
```

## 오프라인과 설치

`public/sw.js` 가 앱 파일을 캐시해 오프라인에서도 실행됩니다. 캐시 목록은 빌드가 끝난 뒤
`scripts/inject-sw.mjs` 가 `dist` 를 훑어 채웁니다. Vite 가 파일 이름에 해시를 붙이므로
손으로 적어 둘 수 없기 때문입니다. 아이콘은 `scripts/make-icons.mjs` 가 만듭니다
(`npm run icons`).

서비스 워커는 프로덕션 빌드에서만 등록됩니다. 개발 서버에서 등록하면 캐시가 코드 수정을
덮어 버립니다.

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

## 테스트

```bash
npm run build       # 먼저 빌드해야 한다. 모든 검증은 프로덕션 빌드를 띄워 돌린다.
npm run test:import    # 불러오기·메타데이터·썸네일
npm run test:edit      # 자르기·트림·지우기·순서·되돌리기
npm run test:clip      # 빈 화면·이미지·볼륨·음소거
npm run test:preview   # 미리보기 재생
npm run test:subtitle  # 자막 입력·타이밍·스타일
npm run test:project   # 자동 저장·복원, 프로젝트 목록, .cutcap 파일
npm run test:mobile    # 모바일 세로 레이아웃, 중앙 고정 재생헤드
npm run test:offline   # 오프라인 실행·설치, iOS 고지, 미지원 브라우저 안내
npm run test:compose   # 전체 내보내기·자막 굽기·.srt·출력 설정
npm run test:e2e       # 내보내기 파이프라인 종단 검증
```

각 검증은 브라우저 안에서 시험용 영상을 만들어 실제 UI에 넣고, 내보낸 결과 파일을
다시 읽어 길이·해상도·오디오·타임스탬프·회전을 검사합니다. 회전 메타데이터가 있는
영상(폰 세로 촬영과 같은 상태)도 함께 확인합니다.

미리보기 서버는 `tests/server.mjs`가 빈 포트를 골라 띄우고 프로세스 그룹째로
정리합니다. 포트를 고정하면 앞선 실행이 남긴 서버와 부딪혀 원인을 알 수 없는
실패가 납니다.

Playwright는 프로젝트 의존성에 넣지 않고 전역 설치본을 씁니다. 다른 환경에서
돌릴 때는 `npm i -D playwright && npx playwright install chromium` 후 실행하세요.

### 알려진 환경 제약

개발 컨테이너의 Chromium은 오픈소스 빌드라 **H.264·AAC 인코딩이 없습니다**(VP9·Opus만
가능). 그래서 자동 테스트는 VP9/Opus로 돌아가며, 코덱만 다르고 디코드 → 인코드 → 먹싱
경로는 프로덕션과 같습니다. **MP4 결과물이 실제 플레이어에서 열리는지는 실기기에서
사람이 확인해야 합니다.**

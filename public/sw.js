/**
 * 오프라인 실행용 서비스 워커 (FR-032, AC-036).
 *
 * 앱은 서버와 주고받는 것이 없다. 화면과 코드만 캐시해 두면 비행기 안에서도
 * 저장된 프로젝트를 열어 편집하고 내보낼 수 있다.
 *
 * 캐시할 파일 목록은 빌드가 끝난 뒤 scripts/inject-sw.mjs 가 채워 넣는다.
 * 파일 이름에 해시가 붙어 있어 손으로 적어 둘 수 없기 때문이다.
 */
const VERSION = '__BUILD_ID__'
const CACHE = `cutcap-${VERSION}`
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // 새로 받은 코드를 다음 방문까지 기다렸다 쓸 이유가 없다.
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 화면 이동은 새 것을 먼저 받아 본다. 오프라인이면 캐시에 둔 첫 화면을 준다.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error())),
    )
    return
  }

  // 코드와 그림은 이름에 해시가 붙어 내용이 바뀌면 주소도 바뀐다.
  // 그러니 캐시에 있으면 그대로 쓰는 것이 항상 옳다.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})

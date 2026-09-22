/**
 * Phase 14 자동 검증 — 오프라인 실행·설치와 환경 고지
 * (FR-027, FR-028, FR-032).
 *
 * AC-031 iOS 에서 프로젝트를 처음 저장하면 7일 삭제 고지와 홈 화면 추가
 *        안내가 한 번 표시된다.
 * AC-032 내보낼 수 없는 브라우저에서는 무엇이 없어서 안 되는지, 어디서
 *        열면 되는지, 편집 내용을 어떻게 지키는지 안내한다.
 * AC-036 한 번 방문한 뒤 오프라인이 되어도 첫 화면이 뜨고, 저장된
 *        프로젝트를 열어 편집할 수 있다.
 *
 *   npm run build && npm run test:offline
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPreviewServer } from './server.mjs'

const { baseUrl: BASE_URL, stop: stopServer } = await startPreviewServer()

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(here, '..')
const bundlePath = join(projectRoot, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs')

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    return import('/opt/node22/lib/node_modules/playwright/index.mjs')
  }
}

const checks = []
function check(name, passed, detail = '') {
  checks.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

let browser
let exitCode = 0
const pageErrors = []

try {
  const { chromium } = await loadPlaywright()
  const bundleSource = await readFile(bundlePath, 'utf8')
  const helpers = await readFile(join(here, 'fixture.js'), 'utf8')

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)

  const clip = await page.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 160,
        heightPx: 120,
        durationSec: 3,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )

  /** 자동 저장은 디바운스가 있다. 저장소에서 직접 확인한다. */
  async function waitForSave(target) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const saved = await target.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('cutcap')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          const projects = await new Promise((resolve, reject) => {
            const request = db.transaction('projects').objectStore('projects').getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          return projects.length > 0
        } finally {
          db.close()
        }
      })
      if (saved) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('자동 저장이 끝나지 않았습니다')
  }

  const addClip = (target, name) =>
    target.evaluate(
      ([bytes, type, fileName]) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([new Uint8Array(bytes)], fileName, { type }))
        const input = document.querySelector('[data-testid="file-input"]')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
      [clip.bytes, clip.mimeType, name],
    )

  // ---------- FR-032 설치 정보 ----------
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href')
  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href)
    return response.ok ? response.json() : null
  }, manifestHref)
  check(
    'FR-032 설치 정보(manifest)가 있다',
    manifest !== null && manifest.name.includes('CutCap') && manifest.display === 'standalone',
    manifest ? `${manifest.short_name} / ${manifest.display}` : '없음',
  )
  const iconOk = await page.evaluate(async (icons) => {
    for (const icon of icons) {
      const response = await fetch(icon.src)
      if (!response.ok) return false
      const blob = await response.blob()
      if (blob.size < 100 || blob.type !== 'image/png') return false
    }
    return true
  }, manifest?.icons ?? [])
  check('FR-032 아이콘 파일이 실제로 있다', iconOk, `${manifest?.icons?.length ?? 0}개`)

  // ---------- AC-036 오프라인 ----------
  await addClip(page, `수업.${clip.extension}`)
  await page.waitForSelector('[data-testid="clip"]', { timeout: 60_000 })

  // 서비스 워커가 자리를 잡고 파일을 캐시할 때까지 기다린다.
  const ready = await page
    .waitForFunction(
      async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return Boolean(registration?.active)
      },
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false)
  check('FR-032 서비스 워커가 등록된다', ready)

  const cached = await page.evaluate(async () => {
    const names = await caches.keys()
    if (names.length === 0) return 0
    const cache = await caches.open(names[0])
    return (await cache.keys()).length
  })
  check('FR-032 앱 파일이 캐시에 담긴다', cached >= 5, `${cached}개`)

  // 저장이 끝난 뒤에 끊어야 "다녀간 적 있는 상태"가 된다.
  await waitForSave(page)

  await context.setOffline(true)
  const reloaded = await page
    .reload({ waitUntil: 'domcontentloaded', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  check('AC-036 오프라인에서도 페이지가 열린다', reloaded)

  const heading = await page
    .locator('h1')
    .innerText()
    .catch(() => '')
  check('AC-036 첫 화면이 정상 표시된다', heading.includes('컷편집'), heading)

  await page.waitForSelector('[data-testid="project-list"]', { timeout: 15_000 })
  await page.click('[data-testid="project-open"]')
  await page.waitForSelector('[data-testid="clip"]', { timeout: 30_000 })
  check(
    'AC-036 오프라인에서 저장된 프로젝트를 연다',
    (await page.locator('[data-testid="clip"]').count()) === 1,
  )

  await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
  const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
  const scale = await page.$eval('[data-testid="timeline"]', (node) =>
    Number(node.dataset.pxPerSecond),
  )
  await page.mouse.click(ruler.x + 1.5 * scale, ruler.y + ruler.height / 2)
  await page.click('[data-testid="split"]')
  check(
    'AC-036 오프라인에서 편집도 된다',
    (await page.locator('[data-testid="clip"]').count()) === 2,
    `${await page.locator('[data-testid="clip"]').count()}개`,
  )

  // 내보내기는 워커와 인코더 코드가 캐시에 있어야 시작된다.
  await page.locator('[data-testid="export-button"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="export-button"]')
  const exported = await page
    .waitForSelector('[data-testid="export-done"]', { timeout: 120_000 })
    .then(() => true)
    .catch(() => false)
  check('AC-036 오프라인에서 내보내기까지 끝난다', exported)
  await context.setOffline(false)

  // ---------- AC-031 iOS 고지 ----------
  const iosContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  })
  const ios = await iosContext.newPage()
  await ios.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  check(
    'AC-031 아직 저장할 것이 없으면 고지하지 않는다',
    (await ios.locator('[data-testid="ios-storage-notice"]').count()) === 0,
  )

  await ios.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)
  await addClip(ios, `아이폰.${clip.extension}`)
  await ios.waitForSelector('[data-testid="clip"]', { timeout: 60_000 })

  const noticed = await ios
    .waitForSelector('[data-testid="ios-storage-notice"]', { timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  check('AC-031 첫 저장 시 고지가 뜬다', noticed)
  if (noticed) {
    const text = await ios.locator('[data-testid="ios-storage-notice"]').innerText()
    check('AC-031 7일 삭제 가능성을 알린다', text.includes('7일'), text.split('\n')[1] ?? '')
    check('AC-031 홈 화면 추가를 안내한다', text.includes('홈 화면에 추가'))
    check('AC-031 프로젝트 파일 저장도 함께 권한다', text.includes('프로젝트 파일 저장'))
  }

  await ios.click('[data-testid="dismiss-ios-notice"]')
  await waitForSave(ios)
  await ios.reload({ waitUntil: 'domcontentloaded' })
  await ios.waitForSelector('[data-testid="project-list"]', { timeout: 15_000 })
  await ios.click('[data-testid="project-open"]')
  await ios.waitForSelector('[data-testid="clip"]', { timeout: 30_000 })
  check(
    'AC-031 한 번 닫으면 다시 뜨지 않는다',
    (await ios.locator('[data-testid="ios-storage-notice"]').count()) === 0,
  )
  await iosContext.close()

  // 데스크톱에서는 이 고지가 뜨지 않아야 한다.
  check(
    'AC-031 iOS 가 아니면 고지하지 않는다',
    (await page.locator('[data-testid="ios-storage-notice"]').count()) === 0,
  )

  // ---------- AC-032 내보낼 수 없는 브라우저 ----------
  const plainContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const plain = await plainContext.newPage()
  // WebCodecs 가 없는 브라우저를 흉내 낸다. 제품 코드에는 시험용 분기가 없다.
  await plain.addInitScript(() => {
    for (const name of ['VideoEncoder', 'VideoDecoder', 'AudioEncoder', 'AudioDecoder']) {
      delete window[name]
    }
  })
  await plain.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await plain.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)
  await addClip(plain, `미지원.${clip.extension}`)
  await plain.waitForSelector('[data-testid="clip"]', { timeout: 60_000 })

  const unsupported = await plain
    .waitForSelector('[data-testid="export-unsupported"]', { timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  check('AC-032 내보낼 수 없으면 그 사실을 알린다', unsupported)
  if (unsupported) {
    const text = await plain.locator('[data-testid="export-unsupported"]').innerText()
    check('AC-032 어느 브라우저로 가면 되는지 알려 준다', text.includes('사파리'), text.split('\n')[2] ?? '')
    check(
      'AC-032 편집 내용을 지키는 방법을 함께 알려 준다',
      text.includes('프로젝트 파일 저장'),
    )
  }
  check(
    'AC-032 내보내기 버튼을 눌러 실패하게 두지 않는다',
    (await plain.locator('[data-testid="export-button"]').count()) === 0,
  )
  check(
    'AC-032 편집은 그대로 할 수 있다',
    (await plain.locator('[data-testid="split"]').count()) === 1,
  )
  await plainContext.close()

  check('페이지 오류 없음', pageErrors.length === 0, pageErrors.join(' | '))
} catch (error) {
  console.error('\n테스트 실행 중 오류:', error)
  if (pageErrors.length > 0) console.error('페이지 오류:', pageErrors.join(' | '))
  exitCode = 1
} finally {
  await browser?.close()
  stopServer()
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
process.exit(failed.length > 0 || exitCode !== 0 ? 1 : 0)

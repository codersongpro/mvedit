/**
 * 글씨체 검증 (FR-050).
 *
 * AC-085 앱 화면은 자체 호스팅한 Pretendard 로 그려지고, 첫 화면에서는 자막 글꼴을 받지 않는다
 * AC-086 자막 모양에서 글씨체를 고르면 모든 자막이 그 글씨체가 된다
 * AC-087 자막 하나만 다른 글씨체로 바꾸고, ‘전체 설정 따름’으로 되돌릴 수 있다
 * AC-088 내보낸 영상에도 고른 글씨체가 새겨진다(기본 글꼴로 떨어지지 않는다)
 * AC-089 앱 글꼴은 첫 방문 캐시에 있고, 자막 글꼴 조각은 쓸 때만 받는다
 *
 *   npm run build && node tests/fonts.e2e.mjs
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

const TEXT = '글씨체 비교 자막입니다'

let browser
let exitCode = 0

try {
  const { chromium } = await loadPlaywright()
  const bundleSource = await readFile(bundlePath, 'utf8')
  const helpers = await readFile(join(here, 'fixture.js'), 'utf8')

  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1200 },
    acceptDownloads: true,
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  const captionRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/fonts/caption/')) captionRequests.push(request.url())
  })

  const installHelpers = (target) =>
    target.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      globalThis.__helpers = await import(url)
    }, helpers)

  // ---------- AC-085 ----------
  await page.goto(BASE_URL, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const ui = await page.evaluate(() => ({
    family: getComputedStyle(document.body).fontFamily,
    loaded: document.fonts.check('16px "Pretendard Variable"', '가나다'),
  }))
  check(
    'AC-085 앱 화면 글꼴이 Pretendard',
    ui.family.startsWith('"Pretendard Variable"'),
    ui.family,
  )
  check('AC-085 Pretendard 파일이 실제로 받아짐', ui.loaded)
  check(
    'AC-085 첫 화면에서는 자막 글꼴을 받지 않음',
    captionRequests.length === 0,
    `${captionRequests.length}건`,
  )

  // ---------- 준비: 영상 하나, 자막 하나 ----------
  await installHelpers(page)
  const clip = await page.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 640,
        heightPx: 360,
        durationSec: 3,
        fps: 10,
      }),
    [bundleSource],
  )
  await page.evaluate(
    ([bytes, type, name]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], name, { type }))
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [clip.bytes, clip.mimeType, `영상.${clip.extension}`],
  )
  await page.waitForSelector('[data-testid="clip"]', { timeout: 60_000 })
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="preview-subtitle-text"]', TEXT)
  // 자막을 길게 늘여 내보낸 영상 어디서든 보이게 한다.
  await page.fill('[data-testid="subtitle-duration"]', '3')

  const overlayFamily = () =>
    page.$eval('[data-testid="subtitle-overlay-text"]', (node) => getComputedStyle(node).fontFamily)
  async function fontReady(family) {
    for (let i = 0; i < 60; i += 1) {
      const ok = await page.evaluate(
        ([name, text]) => document.fonts.check(`400 40px "${name}"`, text),
        [family, TEXT],
      )
      if (ok) return true
      await page.evaluate(
        ([name, text]) => document.fonts.load(`400 40px "${name}"`, text).catch(() => null),
        [family, TEXT],
      )
      await page.waitForTimeout(250)
    }
    return false
  }

  // ---------- AC-086 ----------
  await page.click('[data-testid="subtitle-style"] summary')
  await page.click('[data-testid="caption-font-black-han-sans"]')
  check(
    'AC-086 자막이 Black Han Sans 로',
    (await overlayFamily()).startsWith('"Black Han Sans"'),
    await overlayFamily(),
  )
  check('AC-086 글꼴 조각이 실제로 받아짐', await fontReady('Black Han Sans'))

  // ---------- AC-087 ----------
  await page.click('[data-testid="subtitle-decorate"]')
  await page.click('[data-testid="effect-font-gowun-batang"]')
  check(
    'AC-087 이 자막만 Gowun Batang 으로',
    (await overlayFamily()).startsWith('"Gowun Batang"'),
    await overlayFamily(),
  )
  await page.click('[data-testid="effect-font-inherit"]')
  check(
    'AC-087 전체 설정 따름으로 되돌림',
    (await overlayFamily()).startsWith('"Black Han Sans"'),
    await overlayFamily(),
  )

  // ---------- AC-088 ----------
  async function exportWhite() {
    await page.locator('[data-testid="export-button"]').scrollIntoViewIfNeeded()
    await page.click('[data-testid="export-button"]')
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 240_000 })
    const downloadPromise = page.waitForEvent('download')
    await page.click('[data-testid="download-link"]')
    const bytes = await readFile(await (await downloadPromise).path())
    const name = await page.getAttribute('[data-testid="download-link"]', 'download')
    const verifier = await context.newPage()
    await verifier.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await installHelpers(verifier)
    const [counts] = await verifier.evaluate(
      ([bundle, data, mime]) =>
        globalThis.__helpers.countColor({
          bundleSource: bundle,
          bytes: data,
          mimeType: mime,
          times: [1.5],
          color: [255, 255, 255],
          tolerance: 30,
        }),
      [bundleSource, Array.from(bytes), name.endsWith('.mp4') ? 'video/mp4' : 'video/webm'],
    )
    await verifier.close()
    return counts.bottom
  }

  const heavy = await exportWhite()
  await page.locator('[data-testid="subtitle-style"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="caption-font-pretendard"]')
  const plain = await exportWhite()
  console.log(`  흰 글자 픽셀: Black Han Sans ${heavy} / Pretendard ${plain}`)
  check('AC-088 결과물에 자막이 새겨짐', plain > 200, `${plain}`)
  check(
    'AC-088 글씨체에 따라 결과물 글자가 달라짐(굵은 제목체가 더 많이 칠함)',
    heavy > plain * 1.25,
    `${heavy} vs ${plain}`,
  )

  // ---------- AC-089 ----------
  const sw = await readFile(join(projectRoot, 'dist/sw.js'), 'utf8')
  check(
    'AC-089 Pretendard 는 첫 방문 캐시 목록에 있음',
    sw.includes('/fonts/PretendardVariable.woff2'),
  )
  check('AC-089 자막 글꼴 조각은 캐시 목록에 없음', !sw.includes('/fonts/caption/'))

  check('페이지 오류 없음', pageErrors.length === 0, pageErrors.join(' / '))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  await browser?.close()
  stopServer()
}

const failed = checks.filter((item) => !item.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
process.exit(failed.length > 0 || exitCode ? 1 : 0)

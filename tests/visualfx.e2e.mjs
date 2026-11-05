/**
 * 화면 특수효과 검증 (FR-047): 색감 필터·줌·화면 전환.
 *
 * AC-068 색감 필터를 고르면 미리보기에 바로 걸리고, 결과물도 같은 색감이 된다
 * AC-069 ‘천천히 확대’는 클립 끝으로 갈수록 화면이 커진다
 * AC-070 ‘이 전환을 모든 컷에 적용’은 컷 사이 페이드가 없으면 함께 건다
 * AC-071 흰 번쩍 전환은 이음매에서 화면이 하얘지고, 결과물도 그렇다
 * AC-072 밀어내기 전환은 나가는 클립이 왼쪽으로 밀려난다
 * AC-073 효과를 넣어도 총 길이는 그대로다
 *
 *   npm run build && node tests/visualfx.e2e.mjs
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

/** 시험 영상의 움직이는 하늘색 네모 */
const SKY = [56, 189, 248]

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

  const installHelpers = (target) =>
    target.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      globalThis.__helpers = await import(url)
    }, helpers)

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await installHelpers(page)
  const clip = await page.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 320,
        heightPx: 180,
        durationSec: 4,
        fps: 30,
      }),
    [bundleSource],
  )

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([bytes, type, extension]) => {
      const transfer = new DataTransfer()
      for (const name of ['가', '나']) {
        transfer.items.add(new File([new Uint8Array(bytes)], `${name}.${extension}`, { type }))
      }
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [clip.bytes, clip.mimeType, clip.extension],
  )
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip"]').length === 2,
    null,
    {
      timeout: 60_000,
    },
  )

  const scale = () =>
    page.$eval('[data-testid="timeline"]', (node) => Number(node.dataset.pxPerSecond))
  async function seekTo(seconds) {
    await page
      .locator('[data-testid="ruler"]')
      .evaluate((node) => node.scrollIntoView({ block: 'center' }))
    const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
    await page.mouse.click(ruler.x + seconds * (await scale()), ruler.y + ruler.height / 2)
    await page.waitForFunction(
      (target) =>
        Math.abs(
          Number(document.querySelector('[data-testid="playhead"]').dataset.seconds) - target,
        ) < 0.2,
      seconds,
    )
  }
  const scene = () =>
    page.$eval('[data-testid="preview-scene"]', (node) => {
      const computed = getComputedStyle(node)
      const matrix = new DOMMatrix(computed.transform === 'none' ? undefined : computed.transform)
      return {
        filter: computed.filter,
        scale: matrix.a,
        translateX: matrix.e,
        width: node.offsetWidth,
      }
    })
  const totalText = () =>
    page.$eval(
      '[data-testid="playhead"]',
      () => document.body.innerText.match(/\/ (\d\d:\d\d)/)?.[1],
    )
  const totalBefore = await totalText()

  // ---------- AC-068 ----------
  await page.locator('[data-testid="clip"]').nth(0).click()
  await page.waitForSelector('[data-testid="clip-effects"]')
  await page.click('[data-testid="filter-mono"]')
  await seekTo(1)
  check(
    'AC-068 흑백 필터가 미리보기에 걸림',
    (await scene()).filter === 'grayscale(1)',
    (await scene()).filter,
  )
  await seekTo(5)
  check(
    'AC-068 다른 클립에는 걸리지 않음',
    (await scene()).filter === 'none',
    (await scene()).filter,
  )

  // ---------- AC-069 ----------
  await page.locator('[data-testid="clip"]').nth(1).click()
  await page.click('[data-testid="clip-zoom-in"]')
  await seekTo(4.3)
  const zoomStart = (await scene()).scale
  await seekTo(7.7)
  const zoomEnd = (await scene()).scale
  check(
    'AC-069 천천히 확대: 끝으로 갈수록 커짐',
    zoomStart < 1.02 && zoomEnd > 1.12,
    `${zoomStart.toFixed(3)} → ${zoomEnd.toFixed(3)}`,
  )

  // ---------- AC-070 / AC-071 ----------
  await page.locator('[data-testid="clip"]').nth(0).click()
  await page.click('[data-testid="transition-white"]')
  await page.click('[data-testid="transition-apply-all"]')
  await page.locator('[data-testid="clip"]').nth(1).click()
  check(
    'AC-070 모든 컷 적용: 뒤 클립도 흰 번쩍',
    (await page.getAttribute('[data-testid="transition-white"]', 'aria-pressed')) === 'true',
  )
  check(
    'AC-070 컷 사이 페이드가 함께 켜짐',
    (await page.inputValue('[data-testid="fade-in-slider"]')) === '0.5',
    await page.inputValue('[data-testid="fade-in-slider"]'),
  )
  await seekTo(3.9)
  const flash = await page.$eval('[data-testid="preview-fade"]', (node) => ({
    color: getComputedStyle(node).backgroundColor,
    opacity: Number(getComputedStyle(node).opacity),
  }))
  check(
    'AC-071 이음매에서 화면이 하얘짐(미리보기)',
    flash.color === 'rgb(255, 255, 255)' && flash.opacity > 0.5,
    JSON.stringify(flash),
  )

  // ---------- AC-073 ----------
  check(
    'AC-073 총 길이가 그대로',
    (await totalText()) === totalBefore,
    `${totalBefore} → ${await totalText()}`,
  )

  // ---------- 내보내기 (AC-068, AC-071) ----------
  await page.locator('[data-testid="export-button"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="export-button"]')
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 240_000 })
  const downloadPromise = page.waitForEvent('download')
  await page.click('[data-testid="download-link"]')
  const bytes = await readFile(await (await downloadPromise).path())
  const mimeType = (await page.getAttribute('[data-testid="download-link"]', 'download')).endsWith(
    '.mp4',
  )
    ? 'video/mp4'
    : 'video/webm'

  const verifier = await context.newPage()
  await verifier.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await installHelpers(verifier)
  const sky = await verifier.evaluate(
    ([bundle, data, mime, color]) =>
      globalThis.__helpers.countColor({
        bundleSource: bundle,
        bytes: data,
        mimeType: mime,
        times: [1, 5],
        color,
      }),
    [bundleSource, Array.from(bytes), mimeType, SKY],
  )
  const brightness = await verifier.evaluate(
    ([bundle, data, mime]) =>
      globalThis.__helpers.sampleBrightness({
        bundleSource: bundle,
        bytes: data,
        mimeType: mime,
        times: [2, 3.95],
      }),
    [bundleSource, Array.from(bytes), mimeType],
  )
  await verifier.close()
  const skyCount = (entry) => entry.top + entry.bottom
  console.log('  하늘색 픽셀:', JSON.stringify(sky), '밝기:', JSON.stringify(brightness))
  check(
    'AC-068 결과물: 흑백 클립에는 하늘색이 없음',
    skyCount(sky[0]) < 20,
    `${skyCount(sky[0])}개`,
  )
  check(
    'AC-068 결과물: 원본 클립에는 하늘색이 있음',
    skyCount(sky[1]) > 200,
    `${skyCount(sky[1])}개`,
  )
  check(
    'AC-071 결과물: 이음매 직전이 하얗다',
    brightness[1] > 180 && brightness[1] > brightness[0] + 100,
    `평소 ${brightness[0].toFixed(0)} / 이음매 ${brightness[1].toFixed(0)}`,
  )

  // ---------- AC-072 ----------
  await page.locator('[data-testid="clip"]').nth(0).click()
  await page.click('[data-testid="transition-slide"]')
  await seekTo(3.8)
  const slid = await scene()
  check(
    'AC-072 밀어내기: 나가는 클립이 왼쪽으로',
    slid.translateX < -slid.width * 0.3,
    `${slid.translateX.toFixed(0)}px / 폭 ${slid.width}`,
  )

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

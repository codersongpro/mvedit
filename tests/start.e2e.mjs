/**
 * 시작 화면 검증 (FR-049): 영상 종류 → 스타일 템플릿.
 *
 * AC-080 새 프로젝트 첫 화면에서 종류를 고르면 그 종류에 어울리는 스타일만 보인다
 * AC-081 종류·스타일을 고르고 영상을 넣으면 화면비·해상도·색감·전환·자막 꾸미기가 맞춰진다
 * AC-082 프로젝트 안에서 스타일을 바꾸면 있는 클립·자막 전체가 바뀌고 되돌리기 한 번에 돌아간다
 * AC-083 건너뛰면 예전처럼 원본에 맞춘 기본값으로 시작한다
 * AC-084 고른 종류·스타일은 저장되어, 다시 열어도 새 자막이 그 스타일로 들어간다
 *
 *   npm run build && node tests/start.e2e.mjs
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

try {
  const { chromium } = await loadPlaywright()
  const bundleSource = await readFile(bundlePath, 'utf8')
  const helpers = await readFile(join(here, 'fixture.js'), 'utf8')
  browser = await chromium.launch()
  const pageErrors = []

  async function freshPage() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    return page
  }

  // 시험 영상은 한 번만 만든다. 640×360 이라 원본에 맞추면 480p 가 된다.
  const maker = await freshPage()
  await maker.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)
  const clip = await maker.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 640,
        heightPx: 360,
        durationSec: 4,
        fps: 10,
      }),
    [bundleSource],
  )
  await maker.context().close()

  async function addClips(page, count) {
    await page.evaluate(
      ([bytes, type, extension, n]) => {
        const transfer = new DataTransfer()
        for (let i = 0; i < n; i += 1) {
          transfer.items.add(new File([new Uint8Array(bytes)], `영상${i}.${extension}`, { type }))
        }
        const input = document.querySelector('[data-testid="file-input"]')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
      [clip.bytes, clip.mimeType, clip.extension, count],
    )
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="clip"]').length === n,
      count,
      { timeout: 60_000 },
    )
  }
  const pressed = (page, testId) => page.getAttribute(`[data-testid="${testId}"]`, 'aria-pressed')
  const subtitleWeight = (page) =>
    page.$eval('[data-testid="subtitle-overlay-text"]', (node) => getComputedStyle(node).fontWeight)

  // ---------- AC-080 ----------
  const page = await freshPage()
  check(
    'AC-080 새 프로젝트 첫 화면에 시작 화면',
    await page.isVisible('[data-testid="start-wizard"]'),
  )
  await page.click('[data-testid="start-kind-shorts"]')
  const styles = await page.$$eval('[data-testid^="start-style-"]', (nodes) =>
    nodes.map((node) => node.dataset.testid.replace('start-style-', '')),
  )
  check(
    'AC-080 쇼츠에 어울리는 스타일 4가지',
    styles.join(',') === 'clean,variety,info,neon',
    styles.join(','),
  )
  await page.click('[data-testid="start-back"]')
  check(
    'AC-080 뒤로 가면 종류를 다시 고른다',
    await page.isVisible('[data-testid="start-kind-vlog"]'),
  )
  await page.click('[data-testid="start-kind-shorts"]')
  await page.click('[data-testid="start-style-variety"]')
  check(
    'AC-080 고른 내용을 요약해 보여 준다',
    (await page.innerText('[data-testid="start-summary"]')).includes('쇼츠 · 예능'),
  )

  // ---------- AC-081 ----------
  await addClips(page, 2)
  check(
    'AC-081 영상을 넣으면 시작 화면이 사라진다',
    (await page.locator('[data-testid="start-wizard"], [data-testid="start-summary"]').count()) ===
      0,
  )
  const size = await page.innerText('[data-testid="output-size"]')
  check(
    'AC-081 360p 원본이어도 쇼츠 1080×1920 유지',
    size.includes('1080') && size.includes('1920'),
    size,
  )
  check(
    'AC-081 템플릿·스타일이 골라진 것으로 표시',
    (await pressed(page, 'template-shorts')) === 'true' &&
      (await pressed(page, 'style-variety')) === 'true',
  )
  await page.locator('[data-testid="clip"]').nth(1).click()
  check('AC-081 클립에 예능 색감(선명하게)', (await pressed(page, 'filter-vivid')) === 'true')
  check('AC-081 전환이 흰 번쩍', (await pressed(page, 'transition-white')) === 'true')
  check(
    'AC-081 컷 사이 페이드가 함께 걸림',
    (await page.inputValue('[data-testid="fade-in-slider"]')) === '0.5',
    await page.inputValue('[data-testid="fade-in-slider"]'),
  )
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="preview-subtitle-text"]', '예능 자막')
  check('AC-081 새 자막이 예능 꾸미기(굵게)', (await subtitleWeight(page)) === '800')

  // ---------- AC-082 ----------
  await page.click('[data-testid="style-info"]')
  // 자막을 넣으면 자막이 골라져 클립 칸이 닫힌다. 자막이 있는 둘째 클립을 다시 고른다.
  await page.locator('[data-testid="clip"]').nth(1).click()
  check(
    'AC-082 정보 전달로 바꾸면 클립 색감이 원본으로',
    (await pressed(page, 'filter-none')) === 'true',
  )
  check('AC-082 전환도 밀어내기로', (await pressed(page, 'transition-slide')) === 'true')
  check('AC-082 자막 꾸미기도 바뀜', (await subtitleWeight(page)) === '700')
  await page.click('[data-testid="undo"]')
  await page.locator('[data-testid="clip"]').nth(1).click()
  check(
    'AC-082 되돌리기하면 스타일 표시도 예능으로',
    (await pressed(page, 'style-variety')) === 'true',
  )
  check(
    'AC-082 되돌리기 한 번에 예능으로',
    (await pressed(page, 'filter-vivid')) === 'true' && (await subtitleWeight(page)) === '800',
  )

  // ---------- AC-084 ----------
  await page.click('[data-testid="style-neon"]')
  // 자동 저장은 디바운스가 있다.
  await page.waitForTimeout(1500)
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="project-open"]')
  await page.click('[data-testid="project-open"]')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip"]').length === 2,
    null,
    {
      timeout: 30_000,
    },
  )
  check('AC-084 다시 열어도 스타일이 남아 있다', (await pressed(page, 'style-neon')) === 'true')
  await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
  const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
  const scale = await page.$eval('[data-testid="timeline"]', (node) =>
    Number(node.dataset.pxPerSecond),
  )
  await page.mouse.click(ruler.x + 6 * scale, ruler.y + ruler.height / 2)
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="preview-subtitle-text"]', '네온 자막')
  const glow = await page.$eval(
    '[data-testid="subtitle-overlay-text"]',
    (node) => getComputedStyle(node).textShadow,
  )
  check('AC-084 새 자막이 네온(하늘색 빛 번짐)', glow.includes('rgb(0, 229, 255)'), glow)
  await page.context().close()

  // ---------- AC-083 ----------
  const skipper = await freshPage()
  await skipper.click('[data-testid="start-skip"]')
  check(
    'AC-083 건너뛰면 시작 화면이 사라진다',
    (await skipper.locator('[data-testid="start-wizard"]').count()) === 0,
  )
  await addClips(skipper, 1)
  const plain = await skipper.innerText('[data-testid="output-size"]')
  check('AC-083 원본에 맞춘 해상도(480p)', plain.includes('854') && plain.includes('480'), plain)
  await skipper.locator('[data-testid="clip"]').first().click()
  check('AC-083 색감은 원본 그대로', (await pressed(skipper, 'filter-none')) === 'true')
  await skipper.context().close()

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

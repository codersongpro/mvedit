/**
 * 템플릿 검증 (FR-045).
 *
 * AC-058 쇼츠를 고르면 미리보기가 세로 9:16 이 되고 자막이 쇼츠 모양이 된다
 * AC-059 유튜브로 바꾸면 가로 16:9 와 그 자막 모양으로 바뀐다
 * AC-060 설정을 하나 손으로 바꾸면 템플릿 표시가 꺼진다
 * AC-061 템플릿의 권장 길이를 넘으면 알린다
 *
 *   npm run build && node tests/template.e2e.mjs
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)

  const build = (durationSec, fps) =>
    page.evaluate(
      ([bundle, seconds, rate]) =>
        globalThis.__helpers.buildFixture({
          bundleSource: bundle,
          widthPx: 160,
          heightPx: 90,
          durationSec: seconds,
          fps: rate,
        }),
      [bundleSource, durationSec, fps],
    )
  const short = await build(10, 30)
  // 3분을 넘기는 영상. 장면 수는 상관없으니 초당 프레임을 낮춰 빨리 만든다.
  const long = await build(190, 2)

  async function load(clip) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
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
  }

  const previewRatio = () =>
    page.$eval('[data-testid="preview"]', (node) => {
      const box = node.getBoundingClientRect()
      return box.width / box.height
    })
  const pressed = (id) => page.getAttribute(`[data-testid="template-${id}"]`, 'aria-pressed')
  const overlayStyle = () =>
    page.$eval('[data-testid="subtitle-overlay"]', (node) => ({
      bottom: node.style.bottom,
      color: getComputedStyle(node.querySelector('span')).color,
    }))

  await load(short)
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '템플릿 시험')

  // ---------- AC-058 ----------
  await page.click('[data-testid="template-shorts"]')
  const shortsRatio = await previewRatio()
  check(
    'AC-058 쇼츠: 미리보기가 세로 9:16',
    Math.abs(shortsRatio - 9 / 16) < 0.02,
    shortsRatio.toFixed(3),
  )
  check('AC-058 쇼츠가 골라진 것으로 표시됨', (await pressed('shorts')) === 'true')
  const shortsStyle = await overlayStyle()
  check(
    'AC-058 쇼츠 자막: 노란 글자, 화면 아래 UI 를 피해 30% 위',
    shortsStyle.color === 'rgb(255, 224, 102)' && shortsStyle.bottom === '30%',
    JSON.stringify(shortsStyle),
  )
  check(
    'AC-058 출력 해상도가 1080×1920',
    (await page.innerText('[data-testid="output-size"]')).includes('1080') &&
      (await page.innerText('[data-testid="output-size"]')).includes('1920'),
    await page.innerText('[data-testid="output-size"]'),
  )

  // ---------- AC-059 ----------
  await page.click('[data-testid="template-youtube"]')
  const youtubeRatio = await previewRatio()
  check(
    'AC-059 유튜브: 미리보기가 가로 16:9',
    Math.abs(youtubeRatio - 16 / 9) < 0.03,
    youtubeRatio.toFixed(3),
  )
  const youtubeStyle = await overlayStyle()
  check(
    'AC-059 유튜브 자막: 흰 글자, 아래 8%',
    youtubeStyle.color === 'rgb(255, 255, 255)' && youtubeStyle.bottom === '8%',
    JSON.stringify(youtubeStyle),
  )
  check('AC-059 이전 템플릿 표시가 꺼짐', (await pressed('shorts')) === 'false')

  // ---------- AC-060 ----------
  await page.click('[data-testid="aspect-1:1"]')
  check(
    'AC-060 설정을 손으로 바꾸면 어떤 템플릿도 골라지지 않음',
    (await page.$$eval(
      '[data-testid^="template-"][aria-pressed="true"]',
      (nodes) => nodes.length,
    )) === 0,
  )

  // ---------- AC-061 ----------
  check(
    'AC-061 짧은 영상에는 길이 경고가 없음',
    (await page.locator('[data-testid="template-too-long"]').count()) === 0,
  )
  await load(long)
  await page.click('[data-testid="template-reels"]')
  await page.waitForSelector('[data-testid="template-too-long"]')
  check(
    'AC-061 3분을 넘으면 릴스 길이 경고',
    (await page.innerText('[data-testid="template-too-long"]')).includes('03:00'),
  )
  await page.click('[data-testid="template-vlog"]')
  check(
    'AC-061 길이 제한이 없는 브이로그는 경고 없음',
    (await page.locator('[data-testid="template-too-long"]').count()) === 0,
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

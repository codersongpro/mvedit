/**
 * 특수자막 검증 (FR-046).
 *
 * AC-062 스타일 프리셋(예능)을 고르면 그 자막만 굵고 크게 바뀐다
 * AC-063 등장 애니메이션(톡)은 시작 직후 작게, 조금 뒤 제 크기로 보인다
 * AC-064 단어 강조를 켜면 지금 말하는 단어만 강조색이 된다
 * AC-065 위치를 고르거나 끌어 옮길 수 있고, 끌기 한 번은 되돌리기 한 번이다
 * AC-066 ‘모든 자막에 적용’은 꾸미기를 퍼뜨리되 위치는 옮기지 않는다
 * AC-067 내보낸 영상에도 강조색과 위치가 미리보기와 같게 새겨진다
 *
 *   npm run build && node tests/subtitlefx.e2e.mjs
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

const ACCENT = [255, 90, 95] // 예능 프리셋의 강조색 #FF5A5F

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
        durationSec: 8,
        fps: 30,
      }),
    [bundleSource],
  )

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

  const scale = () =>
    page.$eval('[data-testid="timeline"]', (node) => Number(node.dataset.pxPerSecond))
  const playhead = () =>
    page.$eval('[data-testid="playhead"]', (node) => Number(node.dataset.seconds))
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
  const textStyle = () =>
    page.$eval('[data-testid="subtitle-overlay-text"]', (node) => {
      const computed = getComputedStyle(node)
      return {
        weight: computed.fontWeight,
        size: parseFloat(computed.fontSize),
        transform: computed.transform,
        runs: [...node.children].map((child) => ({
          text: child.textContent,
          color: getComputedStyle(child).color,
        })),
      }
    })
  const anchorY = () =>
    page.$eval('[data-testid="subtitle-overlay"]', (node) => Number(node.dataset.y))

  // 2~4초 자막, 단어 셋
  await seekTo(2)
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '가나다 라마바 사아자')
  const basic = await textStyle()

  // ---------- AC-062 ----------
  await page.click('[data-testid="subtitle-decorate"]')
  await page.waitForSelector('[data-testid="subtitle-effect-editor"]')
  await page.click('[data-testid="effect-preset-variety"]')
  const variety = await textStyle()
  check(
    'AC-062 예능 프리셋: 굵고 크게',
    variety.weight === '800' && variety.size > basic.size,
    `${basic.weight}/${basic.size}px → ${variety.weight}/${variety.size}px`,
  )

  // ---------- AC-063 ----------
  await page.click('[data-testid="effect-animation-pop"]')
  await seekTo(2.08)
  const early = await textStyle()
  const earlyAt = await playhead()
  await seekTo(3)
  const later = await textStyle()
  const scaleOf = (transform) =>
    transform === 'none' ? 1 : Number(transform.match(/matrix\(([^,]+)/)?.[1] ?? 1)
  check(
    'AC-063 톡: 막 나올 때는 작다',
    earlyAt - 2 < 0.3 && scaleOf(early.transform) < 0.98,
    `${earlyAt.toFixed(2)}초 배율 ${scaleOf(early.transform).toFixed(2)}`,
  )
  check('AC-063 톡: 조금 뒤에는 제 크기', Math.abs(scaleOf(later.transform) - 1) < 0.01)

  // ---------- AC-064 ----------
  await page.click('[data-testid="effect-highlight"]')
  await seekTo(2.1)
  const first = await textStyle()
  const accentCss = `rgb(${ACCENT.join(', ')})`
  check(
    'AC-064 처음에는 첫 단어만 강조색',
    first.runs[0]?.text === '가나다' &&
      first.runs[0]?.color === accentCss &&
      first.runs.slice(1).every((run) => run.color !== accentCss),
    JSON.stringify(first.runs),
  )
  await seekTo(3.8)
  const last = await textStyle()
  const lastRun = last.runs[last.runs.length - 1]
  check(
    'AC-064 끝무렵에는 마지막 단어가 강조색',
    lastRun?.text === '사아자' && lastRun?.color === accentCss,
    JSON.stringify(last.runs),
  )

  // ---------- AC-065 ----------
  await page.click('[data-testid="effect-position-top"]')
  check(
    'AC-065 ‘위’를 고르면 위쪽으로',
    Math.abs((await anchorY()) - 0.82) < 0.001,
    String(await anchorY()),
  )

  await page.locator('[data-testid="preview"]').scrollIntoViewIfNeeded()
  const box = await page.locator('[data-testid="subtitle-overlay-text"]').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + step * 20)
  }
  await page.mouse.up()
  const dragged = await anchorY()
  check('AC-065 끌어 내리면 자막이 내려간다', dragged < 0.75, dragged.toFixed(3))
  check(
    'AC-065 끌어 옮긴 위치는 ‘직접 옮긴 위치’로 표시',
    (await page.innerText('[data-testid="subtitle-effect-editor"]')).includes('직접 옮긴 위치'),
  )
  await page.click('[data-testid="undo"]')
  check(
    'AC-065 되돌리기 한 번에 끌기 전 위치로',
    Math.abs((await anchorY()) - 0.82) < 0.001,
    String(await anchorY()),
  )

  // ---------- AC-066 ----------
  await seekTo(6)
  await page.click('[data-testid="add-subtitle"]')
  await page.locator('[data-testid="subtitle-text"]').nth(1).fill('두 번째')
  await page.locator('[data-testid="subtitle-decorate"]').first().click()
  await page.locator('[data-testid="subtitle-decorate"]').first().click()
  await page.click('[data-testid="effect-apply-all"]')
  await seekTo(6.8)
  const second = await textStyle()
  check('AC-066 다른 자막에도 예능 프리셋이 퍼진다', second.weight === '800', second.weight)
  check(
    'AC-066 위치는 퍼지지 않는다(기본 위치 유지)',
    Math.abs((await anchorY()) - 0.08) < 0.001,
    String(await anchorY()),
  )

  // ---------- AC-067 내보내기 ----------
  await page.locator('[data-testid="export-button"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="export-button"]')
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 240_000 })
  const downloadPromise = page.waitForEvent('download')
  await page.click('[data-testid="download-link"]')
  const download = await downloadPromise
  const bytes = await readFile(await download.path())
  const mimeType = (await page.getAttribute('[data-testid="download-link"]', 'download')).endsWith(
    '.mp4',
  )
    ? 'video/mp4'
    : 'video/webm'

  const verifier = await context.newPage()
  await verifier.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await installHelpers(verifier)
  const counts = await verifier.evaluate(
    ([bundle, data, mime, color]) =>
      globalThis.__helpers.countColor({
        bundleSource: bundle,
        bytes: data,
        mimeType: mime,
        times: [2.5, 5],
        color,
      }),
    [bundleSource, Array.from(bytes), mimeType, ACCENT],
  )
  await verifier.close()
  console.log('  강조색 픽셀:', JSON.stringify(counts))
  const [during, outside] = counts
  check('AC-067 강조 단어가 강조색으로 새겨짐', during.top > 30, `${during.top}개`)
  check(
    'AC-067 ‘위’ 위치가 결과물에도 반영(아래 절반엔 없음)',
    during.bottom < during.top / 5,
    `위 ${during.top} / 아래 ${during.bottom}`,
  )
  check(
    'AC-067 자막 밖 시간에는 강조색이 없음',
    outside.top + outside.bottom < 10,
    JSON.stringify(outside),
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

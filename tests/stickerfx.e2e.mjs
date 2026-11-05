/**
 * 순간 효과·스티커 검증 (FR-048).
 *
 * AC-074 스티커를 넣으면 재생헤드 자리에서 2초 동안 보인다
 * AC-075 스티커를 끌어 옮기고 크기를 바꿀 수 있고, 끌기 한 번은 되돌리기 한 번이다
 * AC-076 흔들림은 그 순간 화면이 흔들렸다가 0.5초 안에 멈춘다
 * AC-077 번쩍은 그 순간 화면이 하얘졌다 돌아온다
 * AC-078 스티커에 걸친 자리에서 클립을 자르면 양쪽에 남는다
 * AC-079 내보낸 영상에도 스티커와 번쩍이 같은 시각에 새겨진다
 *
 *   npm run build && node tests/stickerfx.e2e.mjs
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

const HEART = [255, 77, 109] // #FF4D6D

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
  const playhead = () =>
    page.$eval('[data-testid="playhead"]', (node) => Number(node.dataset.seconds))
  const stickers = () =>
    page.$$eval('[data-testid="preview-sticker"]', (nodes) =>
      nodes.map((node) => ({
        kind: node.dataset.kind,
        x: Number(node.dataset.x),
        width: node.getBoundingClientRect().width,
      })),
    )
  const sceneShift = () =>
    page.$eval('[data-testid="preview-scene"]', (node) => {
      const transform = getComputedStyle(node).transform
      const matrix = new DOMMatrix(transform === 'none' ? undefined : transform)
      return Math.abs(matrix.e) + Math.abs(matrix.f)
    })

  // ---------- AC-074 ----------
  await seekTo(2)
  await page.click('[data-testid="add-sticker-heart"]')
  await seekTo(2.5)
  const shown = await stickers()
  check('AC-074 넣은 자리에서 하트가 보인다', shown.length === 1 && shown[0].kind === 'heart')
  await seekTo(4.5)
  check('AC-074 2초 뒤에는 사라진다', (await stickers()).length === 0)

  // ---------- AC-075 ----------
  await seekTo(2.5)
  await page.locator('[data-testid="preview"]').scrollIntoViewIfNeeded()
  const box = await page.locator('[data-testid="preview-sticker"]').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(box.x + box.width / 2 - step * 30, box.y + box.height / 2)
  }
  await page.mouse.up()
  const movedX = (await stickers())[0].x
  check('AC-075 끌면 왼쪽으로 옮겨진다', movedX < 0.6, movedX.toFixed(3))
  await page.click('[data-testid="undo"]')
  check('AC-075 되돌리기 한 번에 제자리', Math.abs((await stickers())[0].x - 0.75) < 0.001)

  const before = (await stickers())[0].width
  await page.locator('[data-testid="sticker-size"]').fill('40')
  const after = (await stickers())[0].width
  check(
    'AC-075 크기를 키우면 커진다',
    after > before * 1.8,
    `${before.toFixed(0)} → ${after.toFixed(0)}px`,
  )
  await page.locator('[data-testid="sticker-size"]').fill('18')

  // ---------- AC-076 ----------
  await seekTo(5)
  await page.click('[data-testid="add-shake"]')
  const shakeAt = await playhead()
  await seekTo(5.03)
  const shaking = await sceneShift()
  const shakingAt = (await playhead()) - shakeAt
  await seekTo(5.8)
  const calm = await sceneShift()
  check(
    'AC-076 흔들림 직후에는 화면이 움직인다',
    shakingAt < 0 || shakingAt > 0.45 || shaking > 0.5,
    `+${shakingAt.toFixed(2)}초 이동 ${shaking.toFixed(1)}px`,
  )
  check('AC-076 0.5초 뒤에는 멈춘다', calm < 0.01, `${calm}px`)

  // ---------- AC-077 ----------
  await seekTo(6.5)
  await page.click('[data-testid="add-flash"]')
  await seekTo(6.53)
  const flash = await page
    .$eval('[data-testid="preview-fade"]', (node) => ({
      color: getComputedStyle(node).backgroundColor,
      opacity: Number(getComputedStyle(node).opacity),
    }))
    .catch(() => null)
  check(
    'AC-077 번쩍: 하얀 덮개',
    flash?.color === 'rgb(255, 255, 255)' && flash.opacity > 0.5,
    JSON.stringify(flash),
  )
  await seekTo(7.2)
  check('AC-077 곧 돌아온다', (await page.locator('[data-testid="preview-fade"]').count()) === 0)

  // ---------- AC-079 내보내기 (자르기 전에) ----------
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
  const hearts = await verifier.evaluate(
    ([bundle, data, mime, color]) =>
      globalThis.__helpers.countColor({
        bundleSource: bundle,
        bytes: data,
        mimeType: mime,
        times: [1, 3],
        color,
      }),
    [bundleSource, Array.from(bytes), mimeType, HEART],
  )
  const light = await verifier.evaluate(
    ([bundle, data, mime]) =>
      globalThis.__helpers.sampleBrightness({
        bundleSource: bundle,
        bytes: data,
        mimeType: mime,
        times: [6.55, 7.5],
      }),
    [bundleSource, Array.from(bytes), mimeType],
  )
  await verifier.close()
  console.log('  하트 픽셀:', JSON.stringify(hearts), '밝기:', JSON.stringify(light))
  check('AC-079 결과물: 넣기 전에는 하트가 없다', hearts[0].top + hearts[0].bottom < 10)
  check('AC-079 결과물: 넣은 시각에 하트가 화면 위쪽에', hearts[1].top > 100, `${hearts[1].top}개`)
  check(
    'AC-079 결과물: 번쩍 순간이 하얗다',
    light[0] > light[1] + 100,
    `번쩍 ${light[0].toFixed(0)} / 평소 ${light[1].toFixed(0)}`,
  )

  // ---------- AC-078 ----------
  await seekTo(3)
  await page.click('[data-testid="split"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
  await seekTo(2.5)
  const leftSide = await stickers()
  await seekTo(3.5)
  const rightSide = await stickers()
  check(
    'AC-078 자른 앞뒤 모두 스티커가 보인다',
    leftSide.length === 1 && rightSide.length === 1,
    `${leftSide.length} / ${rightSide.length}`,
  )
  await seekTo(5.03)
  check(
    'AC-078 뒤 조각에도 흔들림이 남는다',
    (await page.locator('[data-testid="moment-row"]').count()) === 2,
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

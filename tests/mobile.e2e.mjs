/**
 * Phase 13 자동 검증 — 모바일 세로 레이아웃 (FR-029).
 *
 * AC-033 타임라인을 좌우로 밀면 재생헤드는 중앙에 고정된 채 타임라인이
 *        움직이고, 핀치로 확대하면 프레임 단위로 위치를 맞출 수 있다.
 *
 *   npm run build && npm run test:mobile
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPreviewServer } from './server.mjs'

const { baseUrl: BASE_URL, stop: stopServer } = await startPreviewServer()

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(here, '..')
const bundlePath = join(projectRoot, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs')

/** 아이폰 세로에 가까운 화면. 가장 좁은 축에서 성립해야 나머지도 성립한다. */
const VIEWPORT = { width: 390, height: 844 }

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
  const context = await browser.newContext({
    viewport: VIEWPORT,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  })
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
        widthPx: 320,
        heightPx: 180,
        durationSec: 6,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )

  await page.evaluate(
    ([bytes, type]) => {
      const transfer = new DataTransfer()
      for (const name of ['앞.webm', '뒤.webm']) {
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type }))
      }
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [clip.bytes, clip.mimeType],
  )
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip"]').length === 2,
    { timeout: 60_000 },
  )

  const playheadSeconds = () =>
    page.$eval('[data-testid="playhead"]', (node) => Number(node.dataset.seconds))
  const pxPerSecond = () =>
    page.$eval('[data-testid="timeline"]', (node) => Number(node.dataset.pxPerSecond))

  // ---------- 레이아웃 ----------
  check(
    'FR-029 모바일에서는 중앙 고정 모드가 켜진다',
    (await page.getAttribute('[data-testid="timeline"]', 'data-centered')) === 'yes',
    await page.getAttribute('[data-testid="timeline"]', 'data-centered'),
  )

  const toolbar = await page.locator('[data-testid="mobile-toolbar"]').boundingBox()
  check(
    'FR-029 도구 바가 화면 맨 아래에 붙어 있다',
    toolbar !== null && Math.abs(toolbar.y + toolbar.height - VIEWPORT.height) < 2,
    toolbar ? `아래 끝 ${Math.round(toolbar.y + toolbar.height)} / 화면 ${VIEWPORT.height}` : '없음',
  )

  // 페이지를 끝까지 내려도 도구 바는 그대로 있어야 한다.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const afterScroll = await page.locator('[data-testid="mobile-toolbar"]').boundingBox()
  check(
    'FR-029 화면을 내려도 도구 바가 남는다',
    afterScroll !== null && Math.abs(afterScroll.y + afterScroll.height - VIEWPORT.height) < 2,
    afterScroll ? `아래 끝 ${Math.round(afterScroll.y + afterScroll.height)}` : '없음',
  )

  const sizes = await page.$$eval(
    '[data-testid="mobile-toolbar"] button',
    (nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { w: Math.round(box.width), h: Math.round(box.height) }
    }),
  )
  check(
    'FR-029 도구 버튼이 모두 44px 이상',
    sizes.length > 0 && sizes.every((size) => size.w >= 44 && size.h >= 44),
    sizes.map((size) => `${size.w}×${size.h}`).join(', '),
  )
  await page.evaluate(() => window.scrollTo(0, 0))

  // ---------- AC-033 밀어서 이동, 재생헤드는 중앙 고정 ----------
  const centerLine = await page.locator('[data-testid="center-playhead"]').boundingBox()
  const track = await page.locator('[data-testid="timeline"]').boundingBox()
  check(
    'AC-033 재생헤드 선이 타임라인 가로 중앙에 있다',
    Math.abs(centerLine.x + centerLine.width / 2 - (track.x + track.width / 2)) < 2,
    `선 ${Math.round(centerLine.x + centerLine.width / 2)} / 중앙 ${Math.round(track.x + track.width / 2)}`,
  )

  // 손가락으로 미는 조작은 브라우저가 스크롤로 바꿔 준다. 우리 코드가 보는
  // 것은 그 스크롤이므로, 스크롤 위치를 옮겨 같은 길을 지나게 한다.
  const before = await playheadSeconds()
  const scale = await pxPerSecond()
  await page.evaluate((delta) => {
    const scroll = document.querySelector('[data-testid="timeline"]')
    scroll.scrollLeft += delta
    scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
  }, 3 * scale)
  await page.waitForFunction(
    (previous) =>
      Number(document.querySelector('[data-testid="playhead"]').dataset.seconds) > previous + 2.5,
    before,
    { timeout: 5_000 },
  )
  const after = await playheadSeconds()
  check(
    'AC-033 타임라인을 밀면 재생헤드 시각이 따라 움직인다',
    Math.abs(after - (before + 3)) < 0.2,
    `${before.toFixed(2)}초 → ${after.toFixed(2)}초 (3초만큼 밀었음)`,
  )

  const centerAfter = await page.locator('[data-testid="center-playhead"]').boundingBox()
  check(
    'AC-033 민 뒤에도 재생헤드 선은 중앙 그대로',
    Math.abs(centerAfter.x - centerLine.x) < 1,
    `${Math.round(centerAfter.x)} / 이전 ${Math.round(centerLine.x)}`,
  )

  // 클립 안의 실제 재생헤드도 화면 중앙에 와 있어야 한다. 선만 중앙이고
  // 내용이 어긋나면 자르는 위치가 보이는 곳과 달라진다.
  const marker = await page.locator('[data-testid="playhead"]').boundingBox()
  check(
    'AC-033 타임라인 안의 재생헤드도 중앙에 맞는다',
    Math.abs(marker.x + marker.width / 2 - (track.x + track.width / 2)) < 3,
    `${Math.round(marker.x + marker.width / 2)} / 중앙 ${Math.round(track.x + track.width / 2)}`,
  )

  // ---------- AC-033 핀치 확대 ----------
  const beforeZoom = await pxPerSecond()
  const beforeTime = await playheadSeconds()
  for (let step = 0; step < 6; step += 1) {
    await page.click('[data-testid="zoom-in"]')
  }
  const afterZoom = await pxPerSecond()
  check(
    'AC-033 확대하면 배율이 올라간다',
    afterZoom > beforeZoom * 4,
    `${beforeZoom.toFixed(0)} → ${afterZoom.toFixed(0)} px/초`,
  )
  check(
    'AC-033 30fps 한 프레임이 손가락으로 집을 수 있는 폭이 된다',
    afterZoom / 30 >= 8,
    `한 프레임 ${(afterZoom / 30).toFixed(1)}px`,
  )
  check(
    'AC-033 확대해도 보고 있던 시각이 유지된다',
    Math.abs((await playheadSeconds()) - beforeTime) < 0.2,
    `${beforeTime.toFixed(2)}초 → ${(await playheadSeconds()).toFixed(2)}초`,
  )

  const zoomedCenter = await page.locator('[data-testid="playhead"]').boundingBox()
  const zoomedTrack = await page.locator('[data-testid="timeline"]').boundingBox()
  check(
    'AC-033 확대 뒤에도 재생헤드가 중앙에 있다',
    Math.abs(zoomedCenter.x + zoomedCenter.width / 2 - (zoomedTrack.x + zoomedTrack.width / 2)) < 3,
    `${Math.round(zoomedCenter.x + zoomedCenter.width / 2)} / 중앙 ${Math.round(zoomedTrack.x + zoomedTrack.width / 2)}`,
  )

  // ---------- 편집이 한 번의 탭으로 된다 ----------
  await page.click('[data-testid="split"]')
  check(
    'FR-029 자르기 버튼 한 번으로 클립이 나뉜다',
    (await page.locator('[data-testid="clip"]').count()) === 3,
    `${await page.locator('[data-testid="clip"]').count()}개`,
  )
  await page.click('[data-testid="undo"]')
  check(
    'FR-029 되돌리기 버튼 한 번으로 돌아온다',
    (await page.locator('[data-testid="clip"]').count()) === 2,
    `${await page.locator('[data-testid="clip"]').count()}개`,
  )

  // ---------- 가로로 넘치지 않는다 ----------
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  check(
    'FR-029 화면 밖으로 삐져나오는 가로 스크롤이 없다',
    overflow.scrollWidth <= overflow.clientWidth + 1,
    `${overflow.scrollWidth} / ${overflow.clientWidth}`,
  )

  // ---------- 데스크톱은 그대로 ----------
  const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const widePage = await wide.newPage()
  await widePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await widePage.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)
  await widePage.evaluate(
    ([bytes, type]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], '가로.webm', { type }))
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [clip.bytes, clip.mimeType],
  )
  await widePage.waitForSelector('[data-testid="clip"]', { timeout: 60_000 })
  check(
    '넓은 화면에서는 중앙 고정 모드가 꺼진다',
    (await widePage.getAttribute('[data-testid="timeline"]', 'data-centered')) === 'no',
    await widePage.getAttribute('[data-testid="timeline"]', 'data-centered'),
  )
  check(
    '넓은 화면에는 하단 고정 도구 바가 없다',
    (await widePage.locator('[data-testid="mobile-toolbar"]').count()) === 0,
  )
  await wide.close()

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

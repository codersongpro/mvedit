/**
 * Phase 13 자동 검증 — 모바일 세로 레이아웃 (FR-029).
 *
 * AC-033 타임라인은 맨 왼쪽에서 시작하고, 좌우로 밀어 원하는 곳을 찾은 뒤
 *        눌러 재생헤드를 옮긴다. 재생하면 화면이 재생헤드를 따라가고,
 *        핀치로 확대하면 프레임 단위로 위치를 맞출 수 있다.
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
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, {
    timeout: 60_000,
  })

  const playheadSeconds = () =>
    page.$eval('[data-testid="playhead"]', (node) => Number(node.dataset.seconds))
  const pxPerSecond = () =>
    page.$eval('[data-testid="timeline"]', (node) => Number(node.dataset.pxPerSecond))

  // ---------- 레이아웃 ----------
  // 첫 클립은 타임라인 맨 왼쪽에서 시작해야 한다. 앞에 빈 자리를 두면
  // 실기기에서 "화면 절반이 비어 있고 영상이 가운데서 시작하는" 것으로 보인다.
  const firstClipOffset = await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="timeline"]')
    const clip = document.querySelector('[data-testid="clip"]')
    return Math.round(clip.getBoundingClientRect().x - scroll.getBoundingClientRect().x)
  })
  check(
    'FR-029 첫 클립이 타임라인 맨 왼쪽에서 시작한다',
    firstClipOffset <= 12,
    `왼쪽에서 ${firstClipOffset}px`,
  )
  check(
    'FR-029 시작할 때 가로로 밀려 있지 않다',
    (await page.$eval('[data-testid="timeline"]', (node) => node.scrollLeft)) === 0,
  )

  const toolbar = await page.locator('[data-testid="mobile-toolbar"]').boundingBox()
  check(
    'FR-029 도구 바가 화면 맨 아래에 붙어 있다',
    toolbar !== null && Math.abs(toolbar.y + toolbar.height - VIEWPORT.height) < 2,
    toolbar
      ? `아래 끝 ${Math.round(toolbar.y + toolbar.height)} / 화면 ${VIEWPORT.height}`
      : '없음',
  )

  // 페이지를 끝까지 내려도 도구 바는 그대로 있어야 한다.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const afterScroll = await page.locator('[data-testid="mobile-toolbar"]').boundingBox()
  check(
    'FR-029 화면을 내려도 도구 바가 남는다',
    afterScroll !== null && Math.abs(afterScroll.y + afterScroll.height - VIEWPORT.height) < 2,
    afterScroll ? `아래 끝 ${Math.round(afterScroll.y + afterScroll.height)}` : '없음',
  )

  // 자막 추가는 위에 붙은 미리보기와 함께 다녀야 한다. 목록까지 내려가서
  // 누르고 다시 올라와 확인하는 일이 없어야 한다.
  const addSubtitle = await page.locator('[data-testid="add-subtitle"]').boundingBox()
  check(
    'FR-029 화면을 내려도 자막 추가 버튼이 보인다',
    addSubtitle !== null &&
      addSubtitle.y >= 0 &&
      addSubtitle.y + addSubtitle.height <= VIEWPORT.height,
    addSubtitle ? `위치 ${Math.round(addSubtitle.y)}` : '없음',
  )

  const sizes = await page.$$eval('[data-testid="mobile-toolbar"] button', (nodes) =>
    nodes.map((node) => {
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

  // ---------- AC-033 밀어서 찾고, 눌러서 옮긴다 ----------
  const track = await page.locator('[data-testid="timeline"]').boundingBox()
  const scale = await pxPerSecond()

  // 손가락으로 미는 조작은 브라우저가 스크롤로 바꿔 준다.
  await page.evaluate((delta) => {
    const scroll = document.querySelector('[data-testid="timeline"]')
    scroll.scrollLeft += delta
  }, 3 * scale)
  check(
    'AC-033 타임라인을 밀면 화면이 움직인다',
    (await page.$eval('[data-testid="timeline"]', (node) => node.scrollLeft)) > 0,
    `스크롤 ${await page.$eval('[data-testid="timeline"]', (node) => node.scrollLeft)}`,
  )
  check(
    'AC-033 미는 것만으로는 재생헤드가 움직이지 않는다',
    (await playheadSeconds()) === 0,
    `${(await playheadSeconds()).toFixed(2)}초`,
  )

  // 눌러서 그 지점으로 옮긴다. 보이는 위치와 실제 시각이 맞아야 한다.
  const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
  await page.mouse.click(ruler.x + ruler.width / 3, ruler.y + ruler.height / 2)
  const tapped = await playheadSeconds()
  const expected = await page.evaluate(
    ([x]) => {
      const content = document.querySelector('[data-testid="ruler"]').parentElement
      const box = content.getBoundingClientRect()
      const pps = Number(document.querySelector('[data-testid="timeline"]').dataset.pxPerSecond)
      return (x - box.x) / pps
    },
    [ruler.x + ruler.width / 3],
  )
  check(
    'AC-033 누른 자리로 재생헤드가 간다',
    Math.abs(tapped - expected) < 0.1,
    `${tapped.toFixed(2)}초 / 누른 자리 ${expected.toFixed(2)}초`,
  )

  const marker = await page.locator('[data-testid="playhead"]').boundingBox()
  check(
    'AC-033 재생헤드가 화면 안에 보인다',
    marker.x >= track.x && marker.x <= track.x + track.width,
    `${Math.round(marker.x)} / 타임라인 ${Math.round(track.x)}~${Math.round(track.x + track.width)}`,
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

  const zoomedMarker = await page.locator('[data-testid="playhead"]').boundingBox()
  const zoomedTrack = await page.locator('[data-testid="timeline"]').boundingBox()
  check(
    'AC-033 확대 뒤에도 재생헤드가 화면 안에 있다',
    zoomedMarker.x >= zoomedTrack.x && zoomedMarker.x <= zoomedTrack.x + zoomedTrack.width,
    `${Math.round(zoomedMarker.x)} / 타임라인 ${Math.round(zoomedTrack.x)}~${Math.round(zoomedTrack.x + zoomedTrack.width)}`,
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

  // ---------- 자막을 미리보기 아래에서 바로 쓴다 ----------
  // 입력칸이 늦게 생겨 포커스를 놓치면, 띄어쓰기가 재생 단축키로 가서
  // 영상이 재생되고 자막은 비어 버린다. 모바일에서만 드러났다.
  await page.click('[data-testid="add-subtitle"]')
  await page.keyboard.type('첫 자막 입니다')
  check(
    'FR-034 자막 추가 뒤 바로 치는 글자가 자막에 들어간다',
    (await page.inputValue('[data-testid="preview-subtitle-text"]')) === '첫 자막 입니다',
    await page.inputValue('[data-testid="preview-subtitle-text"]'),
  )
  check(
    'FR-034 띄어쓰기를 쳐도 재생되지 않는다',
    (await page.getAttribute('[data-testid="play-toggle"]', 'aria-label')) === '재생',
  )

  // ---------- AC-047 손가락으로 길게 눌러 자막 지우기 ----------
  // 마우스와 달리 실제 터치는 브라우저가 길게 누르기를 가로채 글자 선택이나
  // 기본 메뉴를 띄울 수 있다. CDP 로 진짜 터치를 보내 확인한다.
  await page.evaluate(() => document.activeElement?.blur())
  await page.locator('[data-testid="subtitle-block"]').evaluate((node) => {
    // 위에는 미리보기가, 아래에는 도구 바가 붙어 있다. 그 사이에 오게 둔다.
    node.scrollIntoView({ block: 'end' })
    window.scrollBy(0, 120)
  })
  const block = await page.locator('[data-testid="subtitle-block"]').boundingBox()
  const touchPoint = { x: block.x + Math.min(20, block.width / 2), y: block.y + block.height / 2 }
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="subtitle-block"]') !== null,
    [touchPoint.x, touchPoint.y],
  )
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] })
  await new Promise((resolve) => setTimeout(resolve, 800))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  check(
    'AC-047 손가락으로 길게 누르면 지우기 메뉴가 뜬다',
    await page.locator('[data-testid="subtitle-menu-delete"]').isVisible(),
    hit ? '' : '누른 자리에 자막이 없음',
  )
  const menuBox = await page.locator('[data-testid="subtitle-menu-delete"]').boundingBox()
  check(
    'AC-047 메뉴 버튼이 손가락으로 누를 만한 크기이고 화면 안에 있다',
    menuBox !== null &&
      menuBox.height >= 44 &&
      menuBox.x >= 0 &&
      menuBox.x + menuBox.width <= VIEWPORT.width,
    menuBox ? `${Math.round(menuBox.width)}×${Math.round(menuBox.height)}` : '없음',
  )
  await page.tap('[data-testid="subtitle-menu-delete"]')
  check(
    'AC-047 메뉴를 누르면 자막이 지워진다',
    (await page.locator('[data-testid="subtitle-block"]').count()) === 0,
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

/**
 * Phase 6 자동 검증 — 미리보기 재생 (FR-012).
 *
 * AC-014 분할·삭제·순서 변경을 마친 상태에서 처음부터 재생하면
 *        내보내기 결과와 같은 순서·길이로 재생된다.
 *
 *   npm run build && npm run test:preview
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

  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)

  const makeClip = (durationSec) =>
    page.evaluate(
      ([bundle, seconds]) =>
        globalThis.__helpers.buildFixture({
          bundleSource: bundle,
          widthPx: 160,
          heightPx: 120,
          durationSec: seconds,
          fps: 30,
          rotation: 0,
        }),
      [bundleSource, durationSec],
    )

  const clip = await makeClip(3)

  async function load(names) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ([bytes, type, list]) => {
        const transfer = new DataTransfer()
        for (const name of list) {
          transfer.items.add(new File([new Uint8Array(bytes)], name, { type }))
        }
        const input = document.querySelector('[data-testid="file-input"]')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
      [clip.bytes, clip.mimeType, names],
    )
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="clip"]').length === count,
      names.length,
      { timeout: 60_000 },
    )
  }

  const playhead = () =>
    page.$eval('[data-testid="playhead"]', (node) => Number(node.dataset.seconds))
  const activeSource = () =>
    page.$eval('[data-testid="preview"]', (node) => node.dataset.activeSource)
  const activeKind = () => page.$eval('[data-testid="preview"]', (node) => node.dataset.activeKind)
  const names = () =>
    page.$$eval('[data-testid="clip"]', (nodes) => nodes.map((node) => node.dataset.source))

  // ---------- 기본 재생 ----------
  await load([`가.${clip.extension}`, `나.${clip.extension}`, `다.${clip.extension}`])
  check('미리보기 화면 표시', (await page.locator('[data-testid="preview"]').count()) === 1)
  check(
    '시작 시 첫 클립이 활성',
    (await activeSource()) === `가.${clip.extension}`,
    await activeSource(),
  )

  await page.click('[data-testid="play-toggle"]')
  await page.waitForFunction(
    () => Number(document.querySelector('[data-testid="playhead"]').dataset.seconds) > 0.4,
    { timeout: 15_000 },
  )
  check(
    '재생하면 재생헤드가 움직인다',
    (await playhead()) > 0.4,
    `${(await playhead()).toFixed(2)}초`,
  )

  await page.click('[data-testid="play-toggle"]')
  const paused = await playhead()
  await new Promise((resolve) => setTimeout(resolve, 700))
  check(
    '정지하면 재생헤드가 멈춘다',
    Math.abs((await playhead()) - paused) < 0.1,
    `${paused.toFixed(2)} → ${(await playhead()).toFixed(2)}`,
  )

  // ---------- AC-046 멈춘 채 재생헤드를 옮기면 그 장면이 보인다 ----------
  // 같은 클립 안에서 옮길 때가 문제였다. 클립이 바뀌지 않으면 영상 요소를
  // 다시 맞추지 않아 미리보기가 예전 장면에 멈춰 있었다.
  const visibleVideoTime = () =>
    page.$eval('[data-testid="preview"] video:not(.hidden)', (node) => node.currentTime)
  const seekScale = await page.$eval('[data-testid="timeline"]', (node) =>
    Number(node.dataset.pxPerSecond),
  )
  await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
  const seekRuler = await page.locator('[data-testid="ruler"]').boundingBox()
  for (const target of [1.5, 2.5, 0.5]) {
    await page.mouse.click(seekRuler.x + target * seekScale, seekRuler.y + seekRuler.height / 2)
    const head = await playhead()
    // 탐색은 비동기라 영상 시각이 따라올 때까지 잠깐 기다린다.
    await page
      .waitForFunction(
        (expected) => {
          const video = document.querySelector('[data-testid="preview"] video:not(.hidden)')
          return video && Math.abs(video.currentTime - expected) < 0.05
        },
        head,
        { timeout: 3_000 },
      )
      .catch(() => {})
    const shown = await visibleVideoTime()
    check(
      `AC-046 멈춘 채 ${target}초로 옮기면 미리보기도 그 장면`,
      Math.abs(shown - head) < 0.05,
      `재생헤드 ${head.toFixed(2)}초 / 영상 ${shown.toFixed(2)}초`,
    )
  }

  // ---------- AC-014 편집 결과대로 재생 ----------
  // 가·나·다 → 나 삭제 → 다를 맨 앞으로 → 순서는 다, 가
  await page.locator('[data-testid="clip"]').nth(1).click()
  await page.click('[data-testid="delete"]')
  await page.locator('[data-testid="clip"]').nth(1).click()
  await page.click('[data-testid="move-back"]')
  const expected = await names()
  check(
    'AC-014 준비: 편집 후 순서 다,가',
    expected.join() === `다.${clip.extension},가.${clip.extension}`,
    expected.join(),
  )

  // 처음부터 재생하며 어떤 원본이 언제 보이는지 기록한다.
  await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
  const startRuler = await page.locator('[data-testid="ruler"]').boundingBox()
  await page.mouse.click(startRuler.x + 1, startRuler.y + startRuler.height / 2)
  await page.waitForFunction(
    () => Number(document.querySelector('[data-testid="playhead"]').dataset.seconds) < 0.1,
    { timeout: 5_000 },
  )

  const observed = await page.evaluate(async () => {
    const preview = document.querySelector('[data-testid="preview"]')
    const seen = []
    document.querySelector('[data-testid="play-toggle"]').click()
    const startedAt = performance.now()
    while (performance.now() - startedAt < 12_000) {
      const name = preview.dataset.activeSource
      if (name && seen.at(-1) !== name) seen.push(name)
      const head = Number(document.querySelector('[data-testid="playhead"]').dataset.seconds)
      const total = 6
      if (head >= total - 0.1) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return {
      seen,
      playhead: Number(document.querySelector('[data-testid="playhead"]').dataset.seconds),
    }
  })

  check(
    'AC-014 재생 순서가 타임라인 순서와 일치',
    observed.seen.join() === expected.join(),
    `재생 ${observed.seen.join()} / 타임라인 ${expected.join()}`,
  )
  check(
    'AC-014 전체 길이만큼 재생 후 끝에 도달',
    observed.playhead >= 5.9,
    `${observed.playhead.toFixed(2)}초 / 6.00초`,
  )
  // 관찰 루프는 앱이 멈추기 직전에 빠져나온다. 실제로 멈추는지 기다려 확인한다.
  const stopped = await page
    .waitForFunction(
      () =>
        document.querySelector('[data-testid="play-toggle"]').getAttribute('aria-label') === '재생',
      { timeout: 5_000 },
    )
    .then(() => true)
    .catch(() => false)
  check('AC-014 끝나면 자동으로 멈춘다', stopped)

  // ---------- 빈 화면·사진 구간 ----------
  await load([`가.${clip.extension}`, `나.${clip.extension}`])
  const scale = await page.$eval('[data-testid="timeline"]', (node) =>
    Number(node.dataset.pxPerSecond),
  )
  await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
  const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
  await page.mouse.click(ruler.x + 3 * scale, ruler.y + ruler.height / 2)
  await page.click('[data-testid="insert-blank"]')
  await page.locator('[data-clip-type="blank"]').click()
  await page.click('[data-testid="blank-color-FFFFFF"]')

  // 빈 화면 한가운데(4초)로 옮기면 미리보기가 빈 화면이어야 한다.
  await page.mouse.click(
    ruler.x +
      4 * (await page.$eval('[data-testid="timeline"]', (n) => Number(n.dataset.pxPerSecond))),
    ruler.y + ruler.height / 2,
  )
  check('빈 화면 구간에서 미리보기가 빈 화면', (await activeKind()) === 'blank', await activeKind())
  const blankColor = await page.$eval(
    '[data-testid="preview-blank"]',
    (node) => getComputedStyle(node).backgroundColor,
  )
  check('빈 화면 색이 미리보기에 반영', blankColor === 'rgb(255, 255, 255)', blankColor)

  // ---------- 재생을 따라 타임라인이 움직인다 ----------
  // 확대해 두면 타임라인이 화면보다 넓어진다. 이때 화면이 따라오지 않으면
  // 재생헤드만 화면 밖에서 움직여 지금 어디를 보는지 알 수 없다.
  await load([`가.${clip.extension}`, `나.${clip.extension}`, `다.${clip.extension}`])
  for (let step = 0; step < 5; step += 1) {
    await page.click('[data-testid="zoom-in"]')
  }

  const viewState = () =>
    page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="timeline"]')
      const head = document.querySelector('[data-testid="playhead"]')
      const box = scroll.getBoundingClientRect()
      const mark = head.getBoundingClientRect()
      return {
        scrollLeft: Math.round(scroll.scrollLeft),
        wider: scroll.scrollWidth > scroll.clientWidth,
        visible: mark.x >= box.x && mark.x <= box.x + box.width,
        seconds: Number(head.dataset.seconds),
      }
    })

  const zoomed = await viewState()
  check('확대하면 타임라인이 화면보다 넓어진다', zoomed.wider)
  check(
    '확대해도 재생헤드가 화면 안에 남는다',
    zoomed.visible,
    `스크롤 ${zoomed.scrollLeft}, 재생헤드 ${zoomed.seconds.toFixed(2)}초`,
  )

  await page.click('[data-testid="play-toggle"]')
  const followed = await page
    .waitForFunction(
      (start) => {
        const scroll = document.querySelector('[data-testid="timeline"]')
        return scroll.scrollLeft > start + 50
      },
      zoomed.scrollLeft,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false)
  check('재생하면 타임라인이 따라 움직인다', followed)

  const playingState = await viewState()
  check(
    '재생 중에도 재생헤드가 화면 안에 있다',
    playingState.visible,
    `스크롤 ${playingState.scrollLeft}, 재생헤드 ${playingState.seconds.toFixed(2)}초`,
  )
  await page.click('[data-testid="play-toggle"]')

  // ---------- FR-015 미리보기가 출력 설정을 따른다 ----------
  await load([`가.${clip.extension}`])
  await page.locator('[data-testid="export-settings"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="aspect-9:16"]')
  const previewRatio = () =>
    page.$eval('[data-testid="preview"]', (node) => {
      const box = node.getBoundingClientRect()
      return box.width / box.height
    })
  check(
    '9:16 을 고르면 미리보기도 세로로 바뀐다',
    Math.abs((await previewRatio()) - 9 / 16) < 0.02,
    (await previewRatio()).toFixed(3),
  )
  check(
    '흐린 배경 채우기면 배경 캔버스가 있다',
    (await page.locator('[data-testid="preview-backdrop"]').count()) === 1,
  )
  await page.click('[data-testid="fit-contain"]')
  check(
    '여백 채우기로 바꾸면 배경 캔버스가 사라진다',
    (await page.locator('[data-testid="preview-backdrop"]').count()) === 0,
  )
  await page.click('[data-testid="aspect-source"]')
  check(
    "'원본 그대로'면 미리보기가 원본 비율",
    Math.abs((await previewRatio()) - 160 / 120) < 0.02,
    (await previewRatio()).toFixed(3),
  )

  // ---------- 음소거 ----------
  await load([`가.${clip.extension}`])
  await page.locator('[data-testid="clip"]').click()
  await page.click('[data-testid="toggle-mute"]')
  await page.click('[data-testid="play-toggle"]')
  await page.waitForTimeout(400)
  const muted = await page.$eval('[data-testid="preview"] video', (node) => node.muted)
  check('음소거한 클립은 미리보기에서도 무음', muted === true, String(muted))

  check('페이지 오류 없음', pageErrors.length === 0, pageErrors.join(' | '))
} catch (error) {
  console.error('\n테스트 실행 중 오류:', error)
  exitCode = 1
} finally {
  await browser?.close()
  stopServer()
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
process.exit(failed.length > 0 || exitCode !== 0 ? 1 : 0)

/**
 * Phase 4 자동 검증 — 타임라인 편집 (FR-004~007, FR-013).
 *
 * AC-005 10초 클립, 재생헤드 4초에서 분할 → 4초 + 6초, 총 길이 유지
 * AC-006 끝을 7초로 줄이면 길이가 7초
 * AC-007 다시 10초로 늘리면 복원되고, 원본을 넘겨 늘어나지 않는다
 * AC-008 5초 3개 중 두 번째 삭제 → 총 10초, 사이에 빈틈 없음
 * AC-009 세 번째 클립을 맨 앞으로 → 순서 3-1-2
 * AC-015 편집 10회 후 되돌리기 10회 → 원상 복구, 다시 실행으로 복귀
 *
 *   npm run build && npm run test:edit
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 4186)
const BASE_URL = `http://127.0.0.1:${PORT}/`

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
function near(actual, expected, tolerance = 0.06) {
  return Math.abs(actual - expected) <= tolerance
}

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`미리보기 서버가 ${url} 에서 뜨지 않았습니다.`)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: projectRoot,
  stdio: 'ignore',
})

let browser
let exitCode = 0

try {
  await waitForServer(BASE_URL)
  const { chromium } = await loadPlaywright()
  const bundleSource = await readFile(bundlePath, 'utf8')
  const helpers = await readFile(join(here, 'fixture.js'), 'utf8')

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  const installHelpers = () =>
    page.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      globalThis.__helpers = await import(url)
    }, helpers)

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await installHelpers()

  /** 원하는 길이의 시험용 영상을 만들어 둔다. 인코딩이 느려 한 번만 만든다. */
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

  const clip10 = await makeClip(10)
  const clip5 = await makeClip(5)

  /** 페이지를 초기화하고 지정한 클립들을 타임라인에 올린다. */
  async function loadTimeline(specs) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate((items) => {
      const transfer = new DataTransfer()
      for (const item of items) {
        transfer.items.add(new File([new Uint8Array(item.bytes)], item.name, { type: item.type }))
      }
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, specs)
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="clip"]').length === count,
      specs.length,
      { timeout: 60_000 },
    )
  }

  const durations = () =>
    page.$$eval('[data-testid="clip"]', (nodes) =>
      nodes.map((node) => Number(node.dataset.duration)),
    )
  const names = () =>
    page.$$eval('[data-testid="clip"]', (nodes) => nodes.map((node) => node.dataset.source))
  const pxPerSecond = () =>
    page.$eval('[data-testid="timeline"]', (node) => Number(node.dataset.pxPerSecond))
  const playheadSeconds = () =>
    page.$eval('[data-testid="playhead"]', (node) => Number(node.dataset.seconds))
  const totalText = () => page.locator('[data-testid="timeline-duration"]').innerText()

  /** 눈금자의 지정한 시각 위치를 눌러 재생헤드를 옮긴다. */
  async function seekTo(seconds) {
    const scale = await pxPerSecond()
    await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
    const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
    await page.mouse.click(ruler.x + seconds * scale, ruler.y + ruler.height / 2)
    await page.waitForFunction(
      (target) =>
        Math.abs(Number(document.querySelector('[data-testid="playhead"]').dataset.seconds) - target) < 0.2,
      seconds,
      { timeout: 5_000 },
    )
  }

  /** 선택된 클립의 손잡이를 끌어 길이를 바꾼다. */
  async function dragTrim(edge, deltaSeconds) {
    const scale = await pxPerSecond()
    await page.locator(`[data-testid="trim-${edge}"]`).scrollIntoViewIfNeeded()
    const handle = await page.locator(`[data-testid="trim-${edge}"]`).boundingBox()
    const startX = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    await page.mouse.move(startX, y)
    await page.mouse.down()
    // 여러 번에 나눠 옮겨야 pointermove 가 실제로 발생한다.
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(startX + (deltaSeconds * scale * step) / 4, y)
    }
    await page.mouse.up()
  }

  // ---------- AC-005 분할 ----------
  await loadTimeline([{ bytes: clip10.bytes, name: `십초.${clip10.extension}`, type: clip10.mimeType }])
  await seekTo(4)
  check('AC-005 재생헤드 4초', near(await playheadSeconds(), 4, 0.2), `${await playheadSeconds()}초`)
  await page.click('[data-testid="split"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
  const afterSplit = await durations()
  check('AC-005 두 클립으로 나뉨', afterSplit.length === 2, JSON.stringify(afterSplit))
  check('AC-005 앞 조각 4초', near(afterSplit[0], 4, 0.25), `${afterSplit[0]}초`)
  check('AC-005 뒤 조각 6초', near(afterSplit[1], 6, 0.25), `${afterSplit[1]}초`)
  check(
    'AC-005 총 길이 10초 유지',
    near(afterSplit[0] + afterSplit[1], 10, 0.05),
    await totalText(),
  )

  // ---------- 클립을 누른 지점으로 이동 ----------
  await loadTimeline([{ bytes: clip10.bytes, name: `십초.${clip10.extension}`, type: clip10.mimeType }])
  await page.locator('[data-testid="clip"]').scrollIntoViewIfNeeded()
  const clipBox = await page.locator('[data-testid="clip"]').boundingBox()
  const px = await pxPerSecond()
  // 클립 안 6초 지점을 직접 누른다.
  await page.mouse.click(clipBox.x + 6 * px, clipBox.y + clipBox.height / 2)
  check(
    '클립을 누르면 그 지점으로 재생헤드가 이동',
    near(await playheadSeconds(), 6, 0.2),
    `${(await playheadSeconds()).toFixed(2)}초`,
  )
  check(
    '누른 클립이 선택됨',
    (await page.getAttribute('[data-testid="clip"]', 'data-selected')) === 'true',
  )

  // ---------- AC-006 / AC-007 트림 ----------
  await loadTimeline([{ bytes: clip10.bytes, name: `십초.${clip10.extension}`, type: clip10.mimeType }])
  await page.click('[data-testid="clip"]')
  await dragTrim('end', -3)
  check('AC-006 끝을 줄여 7초', near((await durations())[0], 7, 0.3), `${(await durations())[0]}초`)

  await dragTrim('end', 3)
  check('AC-007 다시 10초로 복원', near((await durations())[0], 10, 0.3), `${(await durations())[0]}초`)

  await dragTrim('end', 5)
  check(
    'AC-007 원본 10초를 넘기지 않음',
    (await durations())[0] <= 10.01,
    `${(await durations())[0]}초`,
  )

  // ---------- AC-008 삭제 ----------
  const three = [1, 2, 3].map((n) => ({
    bytes: clip5.bytes,
    name: `오초_${n}.${clip5.extension}`,
    type: clip5.mimeType,
  }))
  await loadTimeline(three)
  check('AC-008 준비: 총 00:15', (await totalText()).includes('00:15'), await totalText())
  await page.locator('[data-testid="clip"]').nth(1).click()
  await page.click('[data-testid="delete"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
  check('AC-008 총 00:10', (await totalText()).includes('00:10'), await totalText())
  const remaining = await names()
  check('AC-008 지운 클립만 사라짐', remaining.join() === '오초_1.webm,오초_3.webm', remaining.join())
  // 빈틈이 없다는 것은 화면상 두 클립이 맞붙어 있다는 뜻이다.
  const boxes = await page.$$eval('[data-testid="clip"]', (nodes) =>
    nodes.map((node) => node.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })),
  )
  check(
    'AC-008 클립 사이 빈틈 없음',
    Math.abs(boxes[1].left - boxes[0].right) < 1.5,
    `${(boxes[1].left - boxes[0].right).toFixed(2)}px`,
  )

  // ---------- AC-009 순서 변경 ----------
  await loadTimeline(three)
  await page.locator('[data-testid="clip"]').nth(2).click()
  await page.click('[data-testid="move-back"]')
  await page.click('[data-testid="move-back"]')
  const reordered = await names()
  check(
    'AC-009 순서가 3-1-2',
    reordered.join() === '오초_3.webm,오초_1.webm,오초_2.webm',
    reordered.join(),
  )

  // ---------- AC-015 되돌리기 50단계 ----------
  await loadTimeline([{ bytes: clip10.bytes, name: `십초.${clip10.extension}`, type: clip10.mimeType }])
  const before = await durations()
  for (let i = 0; i < 10; i += 1) {
    await seekTo(1 + i * 0.5)
    await page.click('[data-testid="split"]')
  }
  const afterEdits = await durations()
  check('AC-015 편집 10회로 클립 11개', afterEdits.length === 11, `${afterEdits.length}개`)

  for (let i = 0; i < 10; i += 1) await page.click('[data-testid="undo"]')
  const afterUndo = await durations()
  check(
    'AC-015 되돌리기 10회 → 원상 복구',
    afterUndo.length === before.length && near(afterUndo[0], before[0], 0.01),
    JSON.stringify(afterUndo),
  )

  for (let i = 0; i < 10; i += 1) await page.click('[data-testid="redo"]')
  check('AC-015 다시 실행 10회 → 편집 상태로 복귀', (await durations()).length === 11)

  check('페이지 오류 없음', pageErrors.length === 0, pageErrors.join(' | '))
} catch (error) {
  console.error('\n테스트 실행 중 오류:', error)
  exitCode = 1
} finally {
  await browser?.close()
  server.kill()
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
process.exit(failed.length > 0 || exitCode !== 0 ? 1 : 0)

/**
 * Phase 15 자동 검증 — 부하·한계·접근성 (PRD 11절).
 *
 * 실기기 성능(인코딩 시간, 발열)은 여기서 잴 수 없다. 대신 기기와 무관하게
 * 성립해야 하는 것들을 본다 — 클립을 한계까지 넣어도 편집이 즉시 반응하는지,
 * 한계를 넘으면 미리 알리는지, 키보드만으로 편집과 내보내기를 끝낼 수 있는지,
 * 첫 화면이 가벼운지.
 *
 *   npm run build && npm run test:perf
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPreviewServer } from './server.mjs'

const { baseUrl: BASE_URL, stop: stopServer } = await startPreviewServer()

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(here, '..')
const bundlePath = join(projectRoot, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs')

/** PRD 11절: 편집 조작은 200ms 안에 화면에 반영된다. */
const EDIT_BUDGET_MS = 200

/** 첫 화면에 필요한 자바스크립트 예산(gzip 전). 커지면 4G 3초 목표가 깨진다. */
const FIRST_PAINT_JS_BUDGET = 400 * 1024

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
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
        widthPx: 160,
        heightPx: 120,
        durationSec: 4,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )

  // ---------- 첫 화면 무게 ----------
  // 인코딩 코드는 내보낼 때 받아 온다. 첫 화면 번들에 섞이면 안 된다.
  const assets = await readdir(join(projectRoot, 'dist', 'assets'))
  const sizes = {}
  for (const name of assets) {
    sizes[name] = (await stat(join(projectRoot, 'dist', 'assets', name))).size
  }
  const entry = Object.entries(sizes)
    .filter(([name]) => name.startsWith('index-') && name.endsWith('.js'))
    .reduce((sum, [, size]) => sum + size, 0)
  check(
    '첫 화면 자바스크립트가 예산 안에 있다',
    entry < FIRST_PAINT_JS_BUDGET,
    `${(entry / 1024).toFixed(0)} KB / 예산 ${FIRST_PAINT_JS_BUDGET / 1024} KB`,
  )
  const lazy = Object.entries(sizes).filter(
    ([name]) => name.startsWith('import-') || name.startsWith('export.worker-'),
  )
  check(
    '무거운 인코딩 코드는 따로 떨어져 있다',
    lazy.length >= 2 && lazy.every(([, size]) => size > 100 * 1024),
    lazy.map(([name, size]) => `${name.split('-')[0]} ${(size / 1024).toFixed(0)}KB`).join(', '),
  )

  // ---------- 클립 100개 부하 ----------
  // 한 번에 100개를 넣는다. PRD 가 말하는 상한이 실제로 서는지 본다.
  const loadStart = Date.now()
  await page.evaluate(
    ([bytes, type, count]) => {
      const transfer = new DataTransfer()
      for (let index = 0; index < count; index += 1) {
        transfer.items.add(new File([new Uint8Array(bytes)], `클립${index}.webm`, { type }))
      }
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [clip.bytes, clip.mimeType, 100],
  )
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip"]').length === 100,
    { timeout: 300_000 },
  )
  console.log(`  클립 100개 불러오기: ${((Date.now() - loadStart) / 1000).toFixed(1)}초`)
  check(
    '클립 100개가 타임라인에 올라온다',
    (await page.locator('[data-testid="clip"]').count()) === 100,
  )
  check(
    'PRD 11절 클립 100개까지는 경고하지 않는다',
    (await page.locator('[data-testid="limit-notice-clips"]').count()) === 0,
  )

  /** 조작 한 번이 화면에 반영될 때까지 걸린 시간. */
  async function measure(action, expected) {
    const started = Date.now()
    await action()
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="clip"]').length === count,
      expected,
      { timeout: 10_000 },
    )
    return Date.now() - started
  }

  await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
  const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
  const scale = await page.$eval('[data-testid="timeline"]', (node) =>
    Number(node.dataset.pxPerSecond),
  )
  await page.mouse.click(ruler.x + 10 * scale, ruler.y + ruler.height / 2)

  const splitMs = await measure(() => page.click('[data-testid="split"]'), 101)
  check(
    `PRD 11절 자르기가 ${EDIT_BUDGET_MS}ms 이내`,
    splitMs <= EDIT_BUDGET_MS,
    `${splitMs}ms (클립 100개 상태)`,
  )

  await page.locator('[data-testid="clip"]').nth(50).click()
  const deleteMs = await measure(() => page.click('[data-testid="delete"]'), 100)
  check(`PRD 11절 지우기가 ${EDIT_BUDGET_MS}ms 이내`, deleteMs <= EDIT_BUDGET_MS, `${deleteMs}ms`)

  const undoMs = await measure(() => page.click('[data-testid="undo"]'), 101)
  check(`PRD 11절 되돌리기가 ${EDIT_BUDGET_MS}ms 이내`, undoMs <= EDIT_BUDGET_MS, `${undoMs}ms`)

  // 순서 변경은 클립 수가 그대로라 위 헬퍼를 쓸 수 없다. 순서 자체를 본다.
  await page.locator('[data-testid="clip"]').nth(10).click()
  const beforeOrder = await page.$$eval('[data-testid="clip"]', (nodes) =>
    nodes.map((node) => node.dataset.source),
  )
  const movedStart = Date.now()
  await page.click('[data-testid="move-back"]')
  await page.waitForFunction(
    (previous) => {
      const now = [...document.querySelectorAll('[data-testid="clip"]')].map(
        (node) => node.dataset.source,
      )
      return now[9] !== previous[9] || now[10] !== previous[10]
    },
    beforeOrder,
    { timeout: 10_000 },
  )
  const moveMs = Date.now() - movedStart
  check(`PRD 11절 순서 변경이 ${EDIT_BUDGET_MS}ms 이내`, moveMs <= EDIT_BUDGET_MS, `${moveMs}ms`)

  // ---------- 한계 경고 ----------
  await page.evaluate(
    ([bytes, type]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], '한계초과.webm', { type }))
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [clip.bytes, clip.mimeType],
  )
  const overClips = await page
    .waitForSelector('[data-testid="limit-notice-clips"]', { timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check('PRD 11절 클립 100개를 넘으면 미리 알린다', overClips)
  if (overClips) {
    const text = await page.locator('[data-testid="limit-notice-clips"]').innerText()
    check('경고가 무엇을 하라고 알려 준다', text.includes('나눠서'), text.slice(0, 60))
  }
  check(
    'PRD 11절 경고 뒤에도 편집은 그대로 된다',
    (await page.locator('[data-testid="split"]').isEnabled()) === true,
  )

  // 2GB 초과 파일은 아예 받지 않는다. 진짜 2GB 파일을 만들 수는 없으니
  // 크기만 그렇게 보이는 파일로 확인한다(내용은 읽히기 전에 걸러진다).
  await page.evaluate(() => {
    const input = document.querySelector('[data-testid="file-input"]')
    const huge = new File([new Uint8Array(8)], '거대영상.mp4', { type: 'video/mp4' })
    Object.defineProperty(huge, 'size', { value: 3 * 1024 * 1024 * 1024 })
    const transfer = new DataTransfer()
    transfer.items.add(huge)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const rejected = await page
    .waitForSelector('[data-testid="rejected-files"]', { timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check('PRD 11절 2GB 넘는 파일은 열기 전에 거른다', rejected)
  if (rejected) {
    const text = await page.locator('[data-testid="rejected-files"]').innerText()
    check('거른 이유를 크기로 설명한다', text.includes('2.0 GB'), text.split('\n').at(-1) ?? '')
  }

  // ---------- 접근성: 키보드만으로 ----------
  const keyboard = await context.newPage()
  await keyboard.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await keyboard.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)
  await keyboard.evaluate(
    ([bytes, type]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], '키보드.webm', { type }))
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [clip.bytes, clip.mimeType],
  )
  await keyboard.waitForSelector('[data-testid="clip"]', { timeout: 60_000 })

  // 단축키만으로 자르고 되돌린다 (PRD 6절).
  // ←/→ 는 한 프레임씩 움직인다. 2초 지점까지 가야 자를 수 있다 —
  // 너무 앞에서 자르면 길이 0에 가까운 클립이 되어 제품이 거부한다.
  for (let frame = 0; frame < 60; frame += 1) {
    await keyboard.keyboard.press('ArrowRight')
  }
  await keyboard.keyboard.press('s')
  const splitByKey = await keyboard
    .waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, {
      timeout: 5_000,
    })
    .then(() => true)
    .catch(() => false)
  check('PRD 11절 키보드 S 키로 자른다', splitByKey)

  await keyboard.keyboard.press('Control+z')
  const undoByKey = await keyboard
    .waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1, {
      timeout: 5_000,
    })
    .then(() => true)
    .catch(() => false)
  check('PRD 11절 키보드 Ctrl+Z 로 되돌린다', undoByKey)

  // 탭으로 내보내기 버튼까지 가서 엔터로 실행한다.
  const reached = await keyboard.evaluate(async () => {
    const target = document.querySelector('[data-testid="export-button"]')
    if (!target) return false
    // 실제 탭 순서를 확인한다. 화면에 있어도 순서에서 빠지면 닿을 수 없다.
    const focusable = [...document.querySelectorAll('button, input, a[href], [tabindex]')].filter(
      (node) => !node.hasAttribute('disabled') && node.tabIndex >= 0,
    )
    return focusable.includes(target)
  })
  check('PRD 11절 내보내기 버튼이 탭 순서에 있다', reached)

  await keyboard.locator('[data-testid="export-button"]').focus()
  await keyboard.keyboard.press('Enter')
  const exportedByKey = await keyboard
    .waitForSelector('[data-testid="export-done"]', { timeout: 120_000 })
    .then(() => true)
    .catch(() => false)
  check('PRD 11절 키보드만으로 내보내기까지 끝낸다', exportedByKey)

  const hasDownload = await keyboard.evaluate(() => {
    const link = document.querySelector('[data-testid="download-link"]')
    return link !== null && link.tabIndex >= 0
  })
  check('PRD 11절 저장 링크도 키보드로 닿는다', hasDownload)
  await keyboard.close()

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

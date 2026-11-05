/**
 * 자동 자막 검증 (FR-039).
 *
 * 실제 Whisper 모델은 수백 MB 이고 컨테이너에서는 내려받을 수도 없다. 그래서
 * 모델 추론만 맡는 워커 파일을 가짜로 바꿔 끼운다. 소리 꺼내기·창 나누기·
 * 무음 거르기·줄 나누기·자막 넣기·되돌리기는 모두 실제 제품 코드로 돈다.
 *
 * AC-052 전체 자동 자막을 누르면 말소리 구간에 자막이 줄 단위로 들어간다
 * AC-053 효과음 표기와 무음 구간은 자막이 되지 않는다
 * AC-054 기존 자막이 있으면 교체·추가·취소를 묻는다
 * AC-055 한 번의 되돌리기로 자동 자막 전체가 사라진다
 * AC-056 모델을 받지 못하면 이유와 다음 행동을 알려 준다
 * AC-057 음성 인식 엔진은 첫 방문 캐시 목록에 들어가지 않는다
 *
 *   npm run build && node tests/autocaption.e2e.mjs
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

/** 창마다 같은 대본을 돌려주는 가짜 모델. 효과음 표기를 하나 섞는다. */
const FAKE_WORKER = `
self.onmessage = (event) => {
  const m = event.data
  if (m.type === 'load') {
    self.postMessage({ type: 'load-progress', loaded: 50, total: 100 })
    self.postMessage({ type: 'ready' })
    return
  }
  if (m.type === 'transcribe') {
    self.postMessage({ type: 'result', id: m.id, chunks: [
      { text: ' 안녕하세요 여러분 오늘은 자동 자막을 시험해 보겠습니다.', timestamp: [0.2, 4.5] },
      { text: ' [음악]', timestamp: [5, 6] },
      { text: ' 두 번째 문장', timestamp: [6, null] },
    ] })
  }
}
`

/** 모델 파일을 받지 못한 상황 */
const BROKEN_WORKER = `
self.onmessage = (event) => {
  if (event.data.type === 'load') self.postMessage({ type: 'error', message: 'fetch failed' })
}
`

let browser
let exitCode = 0

try {
  const { chromium } = await loadPlaywright()
  const bundleSource = await readFile(bundlePath, 'utf8')
  const helpers = await readFile(join(here, 'fixture.js'), 'utf8')

  browser = await chromium.launch()
  // 서비스 워커가 처음 받은 가짜 워커를 캐시해 두면 바꿔 끼울 수 없다.
  // 오프라인 동작은 offline.e2e 가 따로 본다.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1200 },
    serviceWorkers: 'block',
  })
  let workerSource = FAKE_WORKER
  await context.route('**/assets/transcribe.worker-*.js', (route) =>
    // 교차 출처 격리 페이지의 워커는 자기 응답에도 COEP 가 있어야 뜬다.
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' },
      body: workerSource,
    }),
  )
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)

  const build = (audioAmplitude) =>
    page.evaluate(
      ([bundle, amplitude]) =>
        globalThis.__helpers.buildFixture({
          bundleSource: bundle,
          widthPx: 160,
          heightPx: 120,
          durationSec: 10,
          fps: 30,
          audioAmplitude: amplitude,
        }),
      [bundleSource, audioAmplitude],
    )
  const loud = await build(0.25)
  const silent = await build(0)

  async function load(clip, name) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ([bytes, type, fileName]) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([new Uint8Array(bytes)], fileName, { type }))
        const input = document.querySelector('[data-testid="file-input"]')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
      [clip.bytes, clip.mimeType, `${name}.${clip.extension}`],
    )
    await page.waitForSelector('[data-testid="clip"]', { timeout: 60_000 })
    await page.waitForSelector('[data-testid="caption-all"]:not([disabled])')
  }

  const rowTexts = () =>
    page.$$eval('[data-testid="subtitle-text"]', (nodes) => nodes.map((node) => node.value))
  const waitRows = (count) =>
    page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="subtitle-row"]').length === n,
      count,
      { timeout: 30_000 },
    )

  // ---------- AC-052 / AC-053 ----------
  await load(loud, '말소리')
  await page.click('[data-testid="caption-all"]')
  await page.waitForSelector('[data-testid="caption-done"]', { timeout: 60_000 })
  await waitRows(3)
  const texts = await rowTexts()
  check(
    'AC-052 대본이 24자 이하 줄로 나뉘어 들어감',
    texts.join('|') === '안녕하세요 여러분 오늘은 자동 자막을 시험해|보겠습니다.|두 번째 문장',
    texts.join('|'),
  )
  check(
    'AC-053 효과음 표기([음악])는 자막이 되지 않음',
    !texts.some((text) => text.includes('음악')),
  )
  const times = await page.$$eval('[data-testid="subtitle-seek"]', (nodes) =>
    nodes.map((node) => node.textContent.trim()),
  )
  check(
    'AC-052 자막 시각이 말소리 시각을 따름',
    times.join(',') === '00:00,00:03,00:06',
    times.join(','),
  )
  check(
    'AC-052 완료 안내에 넣은 개수가 나옴',
    (await page.innerText('[data-testid="caption-done"]')).includes('3개'),
  )

  // ---------- AC-055 ----------
  await page.click('[data-testid="undo"]')
  await waitRows(0)
  check('AC-055 되돌리기 한 번에 자동 자막이 모두 사라짐', true)

  // ---------- AC-054 ----------
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '직접 쓴 자막')
  await page.locator('[data-testid="clip"]').first().click()
  await page.click('[data-testid="caption-selected"]')
  await page.waitForSelector('[data-testid="caption-confirm"]')
  check('AC-054 기존 자막이 있으면 확인을 묻는다', true)

  await page.click('[data-testid="caption-cancel-confirm"]')
  check('AC-054 취소하면 아무것도 바뀌지 않음', (await rowTexts()).join('|') === '직접 쓴 자막')

  await page.click('[data-testid="caption-selected"]')
  await page.click('[data-testid="caption-append"]')
  await waitRows(4)
  check('AC-054 추가를 고르면 기존 자막이 남음', (await rowTexts()).includes('직접 쓴 자막'))

  await page.click('[data-testid="caption-selected"]')
  await page.click('[data-testid="caption-replace"]')
  await waitRows(3)
  check('AC-054 교체를 고르면 기존 자막이 사라짐', !(await rowTexts()).includes('직접 쓴 자막'))

  // ---------- AC-053 무음 ----------
  await load(silent, '무음')
  await page.click('[data-testid="caption-all"]')
  await page.waitForSelector('[data-testid="caption-done"]', { timeout: 60_000 })
  check(
    'AC-053 무음 영상에서는 문장을 지어내지 않음',
    (await page.locator('[data-testid="subtitle-row"]').count()) === 0 &&
      (await page.innerText('[data-testid="caption-done"]')).includes('찾지 못했습니다'),
  )

  // ---------- AC-056 ----------
  workerSource = BROKEN_WORKER
  await load(loud, '실패')
  await page.click('[data-testid="caption-all"]')
  await page.waitForSelector('[data-testid="caption-error"]', { timeout: 30_000 })
  const errorText = await page.innerText('[data-testid="caption-error"]')
  check(
    'AC-056 모델을 못 받으면 인터넷 확인·빠름 모델을 안내',
    errorText.includes('인터넷') && errorText.includes('빠름'),
    errorText,
  )
  check(
    'AC-056 실패 뒤에도 다시 시도할 수 있음',
    await page.isEnabled('[data-testid="caption-all"]'),
  )

  // ---------- AC-057 ----------
  const sw = await readFile(join(projectRoot, 'dist/sw.js'), 'utf8')
  check('AC-057 음성 인식 엔진(.wasm)이 첫 방문 캐시 목록에 없음', !/\.wasm"/.test(sw))
  check('AC-057 인식 워커 코드는 캐시 목록에 있음', /transcribe\.worker-/.test(sw))

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

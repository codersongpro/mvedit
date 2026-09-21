/**
 * Phase 5 자동 검증 — 빈 화면·이미지 클립·클립별 소리 (FR-008~011).
 * 더불어 썸네일 비율과 타임라인 확대·축소도 확인한다.
 *
 * AC-010 두 클립 사이에 검정 빈 화면 2초 삽입 → 총 길이 2초 증가
 * AC-011 사진 표시 시간을 5초로 바꾸면 총 길이에 반영
 * AC-012 클립별 음소거 설정이 유지된다
 * (AC-013 혼합 타임라인 오디오 길이는 전체 내보내기가 붙는 Phase 8에서 확인)
 *
 *   npm run build && npm run test:clip
 */
import { spawn } from 'node:child_process'
import zlib from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 4187)
const BASE_URL = `http://127.0.0.1:${PORT}/`

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(here, '..')
const bundlePath = join(projectRoot, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs')

/**
 * PNG 를 코드로 만든다. 미리 적어 둔 base64 는 비율을 바꾸려면 다시 구해야 하고
 * 어디가 틀렸는지 알기 어렵다.
 */
function makePng(width, height, [r, g, b] = [80, 160, 240]) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1)
    raw[rowStart] = 0 // 필터 없음
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 3
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
    }
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([length, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 비트 깊이
  ihdr[9] = 2 // 트루컬러
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 세로로 긴 1:2 비율. 썸네일이 늘어나는지 보려면 정사각형이 아니어야 한다. */
const PNG_TALL = makePng(60, 120)

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)

  // 가로로 납작한 영상(320×120)을 쓴다. 썸네일이 강제로 16:9 가 되면 티가 난다.
  const wide = await page.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 320,
        heightPx: 120,
        durationSec: 4,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )

  async function load(items) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate((list) => {
      const transfer = new DataTransfer()
      for (const entry of list) {
        transfer.items.add(new File([new Uint8Array(entry.bytes)], entry.name, { type: entry.type }))
      }
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, items)
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="clip"]').length === count,
      items.length,
      { timeout: 60_000 },
    )
  }

  const totalText = () => page.locator('[data-testid="timeline-duration"]').innerText()
  const clipCount = () => page.locator('[data-testid="clip"]').count()
  const scale = () =>
    page.$eval('[data-testid="timeline"]', (node) => Number(node.dataset.pxPerSecond))

  const videoEntry = (n) => ({
    bytes: wide.bytes,
    name: `영상${n}.${wide.extension}`,
    type: wide.mimeType,
  })
  const imageEntry = { bytes: Array.from(PNG_TALL), name: '세로사진.png', type: 'image/png' }

  // ---------- 썸네일 비율 ----------
  await load([videoEntry(1), imageEntry])
  const strips = await page.$$eval('[data-testid="clip-filmstrip"]', (nodes) =>
    nodes.map((node) => getComputedStyle(node).backgroundSize),
  )
  check(
    '썸네일을 늘리지 않고 원본 비율 유지',
    strips.length === 2 && strips.every((size) => size === 'auto 100%'),
    JSON.stringify(strips),
  )
  const repeats = await page.$$eval('[data-testid="clip-filmstrip"]', (nodes) =>
    nodes.map((node) => getComputedStyle(node).backgroundRepeat),
  )
  check(
    '긴 클립은 썸네일을 가로로 반복',
    repeats.every((value) => value.startsWith('repeat-x')),
    JSON.stringify(repeats),
  )
  // 원본 비율이 그대로 담겼는지 이미지 자체의 크기로 확인한다.
  const ratios = await page.$$eval('[data-testid="clip-filmstrip"]', (nodes) =>
    Promise.all(
      nodes.map((node) => {
        const url = getComputedStyle(node).backgroundImage.slice(5, -2)
        return new Promise((resolve) => {
          const img = new Image()
          img.onload = () => resolve(Number((img.width / img.height).toFixed(3)))
          img.onerror = () => resolve(null)
          img.src = url
        })
      }),
    ),
  )
  check('영상 썸네일 비율 320:120 ≈ 2.667', Math.abs(ratios[0] - 320 / 120) < 0.05, `${ratios[0]}`)
  check('사진 썸네일 비율 1:2 = 0.5', Math.abs(ratios[1] - 0.5) < 0.05, `${ratios[1]}`)

  // ---------- 확대·축소 ----------
  const base = await scale()
  await page.click('[data-testid="zoom-in"]')
  const zoomedIn = await scale()
  check('확대하면 배율이 커진다', zoomedIn > base, `${base} → ${zoomedIn}`)
  await page.click('[data-testid="zoom-out"]')
  await page.click('[data-testid="zoom-out"]')
  const zoomedOut = await scale()
  check('축소하면 배율이 작아진다', zoomedOut < zoomedIn, `${zoomedIn} → ${zoomedOut}`)

  await page.click('[data-testid="zoom-fit"]')
  await page.waitForFunction(
    (previous) => Number(document.querySelector('[data-testid="timeline"]').dataset.pxPerSecond) !== previous,
    zoomedOut,
  )
  const fitted = await scale()
  const fits = await page.$eval(
    '[data-testid="timeline"]',
    (node) => node.scrollWidth <= node.clientWidth + 2,
  )
  check('맞춤을 누르면 전체가 한 화면에 들어온다', fits, `${fitted} px/s`)

  // 최대 배율에 닿으면 버튼이 꺼지므로 꺼질 때까지만 누른다.
  for (let i = 0; i < 15; i += 1) {
    if (await page.locator('[data-testid="zoom-in"]').isDisabled()) break
    await page.click('[data-testid="zoom-in"]')
  }
  const maxed = await scale()
  check('최대 배율에서 프레임 단위 조작 가능 (≥ 300 px/s)', maxed >= 300, `${maxed} px/s`)
  check(
    '최소 배율에서 긴 영상도 한눈에 (≤ 2 px/s)',
    await page.evaluate(async () => {
      const button = document.querySelector('[data-testid="zoom-out"]')
      for (let i = 0; i < 30 && !button.disabled; i += 1) {
        button.click()
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return Number(document.querySelector('[data-testid="timeline"]').dataset.pxPerSecond) <= 2
    }),
  )

  // ---------- AC-010 빈 화면 ----------
  await load([videoEntry(1), videoEntry(2)])
  const beforeBlank = await totalText()
  check('AC-010 준비: 영상 2개 총 00:08', beforeBlank.includes('00:08'), beforeBlank)

  // 두 클립 사이(4초 지점)에 넣는다.
  const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
  await page.mouse.click(ruler.x + 4 * (await scale()), ruler.y + ruler.height / 2)
  await page.click('[data-testid="insert-blank"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 3)
  check('AC-010 빈 화면이 클립으로 추가됨', (await clipCount()) === 3)
  check('AC-010 총 길이 2초 증가 → 00:10', (await totalText()).includes('00:10'), await totalText())

  const types = await page.$$eval('[data-testid="clip"]', (nodes) =>
    nodes.map((node) => node.dataset.clipType),
  )
  check('AC-010 빈 화면이 두 영상 사이에 놓임', types.join() === 'video,blank,video', types.join())

  await page.locator('[data-clip-type="blank"]').click()
  check(
    'AC-010 빈 화면 배경색 선택 가능',
    (await page.locator('[data-testid="blank-color-FFFFFF"]').count()) === 1,
  )
  await page.click('[data-testid="blank-color-FFFFFF"]')
  const blankColor = await page.$eval('[data-clip-type="blank"] div[style*="background"]', (node) =>
    getComputedStyle(node).backgroundColor,
  )
  check('AC-010 배경색이 흰색으로 바뀜', blankColor === 'rgb(255, 255, 255)', blankColor)

  // ---------- AC-011 사진 표시 시간 ----------
  await load([videoEntry(1), imageEntry])
  check('AC-011 준비: 영상 4초 + 사진 3초 = 00:07', (await totalText()).includes('00:07'), await totalText())
  await page.locator('[data-clip-type="image"]').click()
  await page.fill('[data-testid="duration-input"]', '5')
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="timeline-duration"]').textContent.includes('00:09'),
  )
  check('AC-011 사진 5초로 변경 → 총 00:09', (await totalText()).includes('00:09'), await totalText())

  // ---------- AC-012 클립별 음소거 ----------
  await load([videoEntry(1), videoEntry(2)])
  await page.locator('[data-testid="clip"]').first().click()
  await page.click('[data-testid="toggle-mute"]')
  check(
    'AC-012 첫 클립 음소거 켜짐',
    (await page.getAttribute('[data-testid="toggle-mute"]', 'aria-pressed')) === 'true',
  )
  await page.locator('[data-testid="clip"]').nth(1).click()
  check(
    'AC-012 다른 클립은 음소거되지 않음',
    (await page.getAttribute('[data-testid="toggle-mute"]', 'aria-pressed')) === 'false',
  )
  await page.locator('[data-testid="clip"]').first().click()
  check(
    'AC-012 음소거 설정이 유지됨',
    (await page.getAttribute('[data-testid="toggle-mute"]', 'aria-pressed')) === 'true',
  )
  await page.click('[data-testid="undo"]')
  check(
    'AC-012 되돌리기로 음소거 해제',
    (await page.getAttribute('[data-testid="toggle-mute"]', 'aria-pressed')) === 'false',
  )

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

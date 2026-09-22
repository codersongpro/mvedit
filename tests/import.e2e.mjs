/**
 * Phase 3 자동 검증 — 파일 불러오기와 타임라인 표시 (FR-001~003).
 *
 * AC-001 영상 1개를 고르면 로그인 없이 타임라인에 클립 1개가 생긴다
 * AC-002 영상 3개를 추가하면 순서대로 3개가 이어지고 총 길이가 합과 같다
 * AC-003 이미지를 추가하면 기본 3초짜리 사진 클립이 된다
 * AC-004 못 읽는 파일과 정상 영상을 함께 고르면 정상은 추가되고 실패는 사유가 뜬다
 *
 *   npm run build && npm run test:import
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPreviewServer } from './server.mjs'

const { baseUrl: BASE_URL, stop: stopServer } = await startPreviewServer()
const CLIP = { widthPx: 320, heightPx: 240, durationSec: 3, fps: 30 }

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

/** 1×1 투명 PNG. 이미지 클립 경로만 확인하면 되므로 최소 크기로 쓴다. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let browser
let exitCode = 0

try {
  const { chromium } = await loadPlaywright()
  const bundleSource = await readFile(bundlePath, 'utf8')
  const helpers = await readFile(join(here, 'fixture.js'), 'utf8')
  const workDir = await mkdtemp(join(tmpdir(), 'cutcap-import-'))

  browser = await chromium.launch()
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    globalThis.__helpers = await import(url)
  }, helpers)

  // --- 시험용 파일 준비 ---
  const fixture = await page.evaluate(
    ([bundle, options]) => globalThis.__helpers.buildFixture({ bundleSource: bundle, ...options }),
    [bundleSource, { ...CLIP, rotation: 0 }],
  )
  const videoPath = join(workDir, `clip.${fixture.extension}`)
  await writeFile(videoPath, Buffer.from(fixture.bytes))

  const imagePath = join(workDir, 'photo.png')
  await writeFile(imagePath, PNG_1PX)

  // 확장자만 영상인 쓰레기 파일. 디코더가 거부해야 한다.
  const brokenPath = join(workDir, 'broken.mp4')
  await writeFile(brokenPath, Buffer.from('이건 영상이 아닙니다'.repeat(50)))

  const clipCount = () => page.locator('[data-testid="clip"]').count()
  const totalText = () => page.locator('[data-testid="timeline-duration"]').innerText()

  // --- AC-001 영상 1개 ---
  check('시작 시 타임라인이 비어 있음', (await clipCount()) === 0)
  await page.setInputFiles('[data-testid="file-input"]', videoPath)
  await page.waitForSelector('[data-testid="clip"]', { timeout: 20_000 })
  check('AC-001 영상 1개 → 클립 1개', (await clipCount()) === 1)
  // "로그인 없이" 는 문구가 아니라 실제로 자격 증명을 요구하지 않는다는 뜻이다.
  check(
    'AC-001 자격 증명 입력란 없음',
    (await page.locator('input[type="password"], input[type="email"], form').count()) === 0,
  )

  // --- AC-002 영상 3개 (이미 1개 있으므로 2개 더 추가) ---
  await page.setInputFiles('[data-testid="file-input"]', [videoPath, videoPath])
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip"]').length === 3,
    { timeout: 30_000 },
  )
  check('AC-002 영상 3개 → 클립 3개', (await clipCount()) === 3)
  check('AC-002 총 길이 = 3초 × 3 = 00:09', (await totalText()).includes('00:09'), await totalText())

  // --- AC-003 이미지 ---
  await page.setInputFiles('[data-testid="file-input"]', imagePath)
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip"]').length === 4,
    { timeout: 20_000 },
  )
  const imageClips = await page.locator('[data-clip-type="image"]').count()
  check('AC-003 사진이 이미지 클립으로 추가됨', imageClips === 1)
  check(
    'AC-003 사진 기본 3초 → 총 00:12',
    (await totalText()).includes('00:12'),
    await totalText(),
  )

  // --- AC-004 깨진 파일 + 정상 영상 ---
  await page.setInputFiles('[data-testid="file-input"]', [brokenPath, videoPath])
  await page.waitForSelector('[data-testid="rejected-files"]', { timeout: 20_000 })
  const rejectedText = await page.locator('[data-testid="rejected-files"]').innerText()
  check('AC-004 실패한 파일명 표시', rejectedText.includes('broken.mp4'), rejectedText.replace(/\n/g, ' / '))
  check('AC-004 실패 사유 표시', /열 수 없|문제가 생겼/.test(rejectedText))
  check('AC-004 같이 고른 정상 영상은 추가됨', (await clipCount()) === 5, `${await clipCount()}개`)

  // --- 한글 파일명 ---
  // 이 컨테이너의 Playwright setInputFiles 는 비ASCII 파일명을 전달하지 못한다.
  // 도구 한계일 뿐 제품 문제가 아니므로, 페이지 안에서 File 을 만들어
  // 실제 change 이벤트로 흘려보내 확인한다. 주 사용자가 한국어권이라
  // 이 경로는 반드시 고정해 둔다.
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([bytes, name, mime]) => {
      const file = new File([new Uint8Array(bytes)], name, { type: mime })
      const transfer = new DataTransfer()
      transfer.items.add(file)
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [fixture.bytes, `수업 녹화본.${fixture.extension}`, fixture.mimeType],
  )
  await page.waitForSelector('[data-testid="clip"]', { timeout: 20_000 })
  const koreanCaption = await page.locator('[data-testid="clip"] figcaption p').first().innerText()
  check(
    '한글·띄어쓰기 파일명 처리',
    koreanCaption === `수업 녹화본.${fixture.extension}`,
    JSON.stringify(koreanCaption),
  )

  // --- 썸네일 ---
  const withThumbnail = await page.locator('[data-testid="clip-filmstrip"]').count()
  check('클립 썸네일 생성', withThumbnail === 1, `${withThumbnail}/1`)

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

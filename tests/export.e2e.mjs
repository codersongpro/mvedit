/**
 * Phase 2 자동 검증 (V2).
 *
 * 브라우저에서 시험용 영상을 만들어 앱의 실제 UI에 넣고 내보낸 뒤,
 * 결과 파일을 다시 읽어 길이·해상도·오디오·타임스탬프·회전을 확인한다.
 *
 * 컨테이너 Chromium은 H.264·AAC 인코딩이 없어 VP9/Opus로 돌아간다.
 * 코덱만 다르고 디코드 → 인코드 → 먹싱 경로는 프로덕션과 동일하다.
 * MP4 결과물이 실제 플레이어에서 열리는지는 사람이 실기기에서 확인해야 한다.
 *
 *   npm run build && npm run test:e2e
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 4183)
const BASE_URL = `http://127.0.0.1:${PORT}/`
const FIXTURE = { widthPx: 320, heightPx: 240, durationSec: 3, fps: 30 }

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(here, '..')
const bundlePath = join(projectRoot, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.mjs')

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    // 컨테이너에는 playwright가 전역 설치돼 있고 프로젝트 의존성에는 넣지 않는다.
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
      /* 서버가 아직 안 떴다 */
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
  const workDir = await mkdtemp(join(tmpdir(), 'mvedit-e2e-'))

  browser = await chromium.launch()
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()

  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  // 헬퍼를 blob 모듈로 주입한다. 제품 코드에는 테스트용 훅을 두지 않는다.
  const installHelpers = (target) =>
    target.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      globalThis.__helpers = await import(url)
    }, helpers)

  /**
   * 시험용 영상 하나를 만들어 앱에 넣고 내보낸 뒤 결과를 검사한다.
   * rotation 이 0이 아니면 폰으로 세로 촬영한 영상과 같은 상태가 된다
   * (픽셀은 가로로 저장되고 회전은 메타데이터에만 기록됨).
   */
  async function runCase({ label, rotation }) {
    await installHelpers(page)
    const fixture = await page.evaluate(
      ([bundle, options]) => globalThis.__helpers.buildFixture({ bundleSource: bundle, ...options }),
      [bundleSource, { ...FIXTURE, rotation }],
    )
    const fixturePath = join(workDir, `fixture-${rotation}.${fixture.extension}`)
    await writeFile(fixturePath, Buffer.from(fixture.bytes))
    console.log(
      `\n[${label}] 시험용 파일: ${fixture.extension} (${fixture.videoCodec}/${fixture.audioCodec}), ` +
        `${(fixture.bytes.length / 1024).toFixed(0)} KB, 회전 ${rotation}°`,
    )

    await page.setInputFiles('[data-testid="file-input"]', fixturePath)
    await page.waitForSelector('[data-testid="media-info"]', { timeout: 20_000 })

    // 회전된 영상은 가로·세로가 바뀌어 보이는 게 정상이다.
    const expectedW = rotation % 180 === 0 ? FIXTURE.widthPx : FIXTURE.heightPx
    const expectedH = rotation % 180 === 0 ? FIXTURE.heightPx : FIXTURE.widthPx

    const infoText = await page.locator('[data-testid="media-info"]').innerText()
    check(
      `[${label}] 메타데이터 — ${expectedW}×${expectedH}`,
      infoText.includes(`${expectedW}×${expectedH}`),
      infoText.replace(/\n/g, ' / '),
    )
    check(`[${label}] 메타데이터 — 길이 00:03`, infoText.includes('00:03'))

    await page.click('[data-testid="export-button"]')
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 120_000 })

    const downloadPromise = page.waitForEvent('download')
    await page.click('[data-testid="download-link"]')
    const download = await downloadPromise
    const outputPath = join(workDir, `out-${rotation}-${download.suggestedFilename()}`)
    await download.saveAs(outputPath)

    const outputBytes = await readFile(outputPath)
    const verifier = await context.newPage()
    await verifier.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await installHelpers(verifier)
    const result = await verifier.evaluate(
      ([bundle, bytes, mimeType]) =>
        globalThis.__helpers.inspectFile({ bundleSource: bundle, bytes, mimeType }),
      [bundleSource, Array.from(outputBytes), fixture.mimeType],
    )
    await verifier.close()

    console.log(`[${label}] 결과:`, JSON.stringify(result))

    const durationDelta = Math.abs(result.duration - FIXTURE.durationSec)
    check(`[${label}] 길이 오차 ±0.1초 이내`, durationDelta <= 0.1, `${durationDelta.toFixed(3)}초 차이`)
    check(
      `[${label}] 보이는 크기 유지`,
      result.width === expectedW && result.height === expectedH,
      `${result.width}×${result.height} (기대 ${expectedW}×${expectedH})`,
    )
    check(`[${label}] 오디오 트랙 존재`, result.hasAudio, String(result.audioCodec))
    check(`[${label}] 타임스탬프 단조 증가`, result.monotonic)
    check(
      `[${label}] 프레임 수 보존`,
      Math.abs(result.frameCount - FIXTURE.durationSec * FIXTURE.fps) <= 2,
      `${result.frameCount} 프레임`,
    )
    // 회전을 픽셀에 구워 넣었으므로 결과 파일에는 회전 메타데이터가 남지 않아야 한다.
    // 여기가 0이 아니면 메타데이터를 무시하는 플레이어에서 영상이 눕는다.
    check(
      `[${label}] 회전이 픽셀에 반영됨 (메타데이터 0°)`,
      result.rotation === 0,
      `${result.rotation}°`,
    )

    console.log(`[${label}] 산출물: ${outputPath}`)
  }

  await runCase({ label: '기본', rotation: 0 })
  await runCase({ label: '세로촬영 90°', rotation: 90 })

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

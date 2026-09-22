/**
 * Phase 8 자동 검증 — 타임라인 전체 내보내기 (FR-020, 021, 030, 037, 038).
 *
 * AC-013 영상+사진+빈 화면이 섞여도 오디오 길이가 영상 길이와 같고,
 *        소리 없는 구간 때문에 뒤 구간 소리가 앞으로 당겨지지 않는다
 * AC-023 결과 파일이 정상 재생 가능한 형식이다
 * AC-024 내보내는 중 취소할 수 있다
 * AC-043 자막이 영상 프레임에 새겨진다
 * AC-044 .srt 타임코드가 영상의 자막 시점과 일치한다
 *
 *   npm run build && npm run test:compose
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const PORT = Number(process.env.PORT ?? 4190)
const BASE_URL = `http://127.0.0.1:${PORT}/`

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(here, '..')
const bundlePath = join(projectRoot, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs')

function makePng(width, height, [r, g, b] = [220, 80, 80]) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1)
    raw[rowStart] = 0
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
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

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
  const workDir = await mkdtemp(join(tmpdir(), 'cutcap-compose-'))

  browser = await chromium.launch()
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage({ viewport: { width: 1280, height: 1200 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  const installHelpers = (target) =>
    target.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      globalThis.__helpers = await import(url)
    }, helpers)

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await installHelpers(page)

  // 4초 영상 두 개. 소리가 실려 있어 무음 구간과 구분된다.
  const clip = await page.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 320,
        heightPx: 240,
        durationSec: 4,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )
  const photo = Array.from(makePng(160, 120))

  async function loadProject(entries) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate((list) => {
      const transfer = new DataTransfer()
      for (const entry of list) {
        transfer.items.add(new File([new Uint8Array(entry.bytes)], entry.name, { type: entry.type }))
      }
      const input = document.querySelector('[data-testid="file-input"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, entries)
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="clip"]').length === count,
      entries.length,
      { timeout: 60_000 },
    )
  }

  const scale = () =>
    page.$eval('[data-testid="timeline"]', (node) => Number(node.dataset.pxPerSecond))
  async function seekTo(seconds) {
    await page.locator('[data-testid="ruler"]').scrollIntoViewIfNeeded()
    const ruler = await page.locator('[data-testid="ruler"]').boundingBox()
    await page.mouse.click(ruler.x + seconds * (await scale()), ruler.y + ruler.height / 2)
    await page.waitForFunction(
      (target) =>
        Math.abs(Number(document.querySelector('[data-testid="playhead"]').dataset.seconds) - target) < 0.2,
      seconds,
    )
  }

  /** 내보내기를 실행하고 저장된 파일 경로를 돌려준다. */
  async function exportAndSave(label) {
    await page.locator('[data-testid="export-button"]').scrollIntoViewIfNeeded()
    await page.click('[data-testid="export-button"]')
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 240_000 })

    // 저장 경로는 우리가 정한다. 브라우저가 알려 주는 이름은 둘 다
    // "download" 로 같아져 서로 덮어쓴다.
    const videoName = await page.getAttribute('[data-testid="download-link"]', 'download')
    const videoPromise = page.waitForEvent('download')
    await page.click('[data-testid="download-link"]')
    const videoDownload = await videoPromise
    const videoPath = join(workDir, `${label}-video`)
    await videoDownload.saveAs(videoPath)

    let srtPath = null
    let srtName = null
    if (await page.locator('[data-testid="download-srt"]').count()) {
      srtName = await page.getAttribute('[data-testid="download-srt"]', 'download')
      const srtPromise = page.waitForEvent('download')
      await page.click('[data-testid="download-srt"]')
      const srtDownload = await srtPromise
      srtPath = join(workDir, `${label}-subtitle.srt`)
      await srtDownload.saveAs(srtPath)
    }
    return { videoPath, srtPath, videoName, srtName }
  }

  /** 결과 파일을 브라우저에서 다시 읽어 검사한다. */
  async function inspect(filePath, mimeType) {
    const bytes = await readFile(filePath)
    const verifier = await context.newPage()
    await verifier.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await installHelpers(verifier)
    const result = await verifier.evaluate(
      ([bundle, data, mime]) =>
        globalThis.__helpers.inspectFile({ bundleSource: bundle, bytes: data, mimeType: mime }),
      [bundleSource, Array.from(bytes), mimeType],
    )
    await verifier.close()
    return result
  }

  // ---------- AC-013 혼합 타임라인 ----------
  // 영상(4초) + 사진(3초) + 영상(4초), 사이에 빈 화면 2초 → 총 13초
  await loadProject([
    { bytes: clip.bytes, name: `앞영상.${clip.extension}`, type: clip.mimeType },
    { bytes: photo, name: '사진.png', type: 'image/png' },
    { bytes: clip.bytes, name: `뒤영상.${clip.extension}`, type: clip.mimeType },
  ])
  await seekTo(7) // 사진 끝 = 빈 화면이 들어갈 자리
  await page.click('[data-testid="insert-blank"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 4)

  const totalText = await page.locator('[data-testid="timeline-duration"]').innerText()
  check('AC-013 준비: 총 00:13', totalText.includes('00:13'), totalText)

  const mixed = await exportAndSave('mixed')
  const mixedInfo = await inspect(mixed.videoPath, clip.mimeType)
  console.log('  혼합 결과:', JSON.stringify({ ...mixedInfo, audioEnergy: undefined }))

  check(
    'AC-013 영상 길이가 타임라인과 일치',
    Math.abs(mixedInfo.duration - 13) <= 0.3,
    `${mixedInfo.duration.toFixed(2)}초 / 13초`,
  )
  check('AC-023 오디오 트랙 존재', mixedInfo.hasAudio, String(mixedInfo.audioCodec))
  check(
    'AC-013 오디오 길이가 영상 길이와 일치',
    mixedInfo.audioDuration !== null && Math.abs(mixedInfo.audioDuration - mixedInfo.duration) <= 0.3,
    `오디오 ${mixedInfo.audioDuration?.toFixed(2)}초 / 영상 ${mixedInfo.duration.toFixed(2)}초`,
  )
  check('AC-023 타임스탬프 단조 증가', mixedInfo.monotonic)

  // 구간별 소리 유무: 0~4초 소리 / 4~9초 무음(사진+빈화면) / 9~13초 소리
  const peakBetween = (from, to) => {
    const inRange = (mixedInfo.audioEnergy ?? []).filter((b) => b.t >= from && b.t < to)
    return inRange.length === 0 ? 0 : Math.max(...inRange.map((b) => b.peak))
  }
  const firstVideoPeak = peakBetween(0.5, 3.5)
  const stillPeak = peakBetween(4.5, 8.5)
  const lastVideoPeak = peakBetween(9.5, 12.5)
  check('AC-013 앞 영상 구간에 소리가 있다', firstVideoPeak > 0.05, firstVideoPeak.toFixed(3))
  check('AC-013 사진·빈 화면 구간은 무음', stillPeak < 0.01, stillPeak.toFixed(4))
  check(
    'AC-013 뒤 영상 구간의 소리가 앞으로 당겨지지 않았다',
    lastVideoPeak > 0.05,
    lastVideoPeak.toFixed(3),
  )

  // ---------- AC-043 / AC-044 자막 ----------
  await loadProject([{ bytes: clip.bytes, name: `자막영상.${clip.extension}`, type: clip.mimeType }])
  await seekTo(1)
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '자막 확인')
  await page.click('[data-testid="subtitle-style"] summary')
  await page.click('[data-testid="font-아주 크게"]')

  const subtitled = await exportAndSave('subtitled')
  check('AC-044 .srt 파일이 함께 나온다', subtitled.srtPath !== null)
  check(
    '저장 파일 이름에 원본 이름과 확장자가 붙는다',
    subtitled.videoName?.startsWith('자막영상_cutcap.') === true,
    String(subtitled.videoName),
  )
  check('자막 파일 이름이 .srt', subtitled.srtName?.endsWith('.srt') === true, String(subtitled.srtName))

  const srt = await readFile(subtitled.srtPath, 'utf8')
  console.log('  srt:', JSON.stringify(srt))
  check('AC-044 SRT 번호와 내용', srt.startsWith('1\n') && srt.includes('자막 확인'), srt.split('\n')[0])
  check(
    'AC-044 SRT 타임코드가 자막 시점과 일치 (1~3초)',
    /00:00:01,0\d\d --> 00:00:03,0\d\d/.test(srt),
    srt.split('\n')[1],
  )

  // 자막이 프레임에 새겨졌는지: 자막 구간과 비자막 구간의 픽셀을 비교한다.
  const burnedCheck = await inspectBurnedSubtitle(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile(subtitled.videoPath),
    clip.mimeType,
  )
  console.log('  자막 픽셀:', JSON.stringify(burnedCheck))
  check(
    'AC-043 자막 구간 하단에 글자가 새겨졌다',
    burnedCheck.withSubtitle > burnedCheck.withoutSubtitle * 2 + 200,
    `자막 구간 ${burnedCheck.withSubtitle} vs 비자막 구간 ${burnedCheck.withoutSubtitle} (밝은 픽셀 수)`,
  )

  // ---------- AC-024 취소 ----------
  // 취소할 틈이 있으려면 일이 충분히 커야 한다. 4초짜리 여섯 개.
  await loadProject(
    [1, 2, 3, 4, 5, 6].map((n) => ({
      bytes: clip.bytes,
      name: `취소${n}.${clip.extension}`,
      type: clip.mimeType,
    })),
  )
  await page.locator('[data-testid="export-button"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="export-button"]')
  await page.waitForSelector('[data-testid="cancel-export"]', { timeout: 30_000 })
  await page.click('[data-testid="cancel-export"]')
  const canceled = await page
    .waitForSelector('[data-testid="export-error"]', { timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  check('AC-024 내보내기 취소', canceled)
  if (canceled) {
    const message = await page.locator('[data-testid="export-error"]').innerText()
    check('AC-024 취소 안내 표시', message.includes('취소'), message)
  }
  check('AC-024 취소 후 타임라인 유지', (await page.locator('[data-testid="clip"]').count()) === 6)

  check('페이지 오류 없음', pageErrors.length === 0, pageErrors.join(' | '))
} catch (error) {
  console.error('\n테스트 실행 중 오류:', error)
  exitCode = 1
} finally {
  await browser?.close()
  server.kill()
}

/**
 * 자막이 실제로 픽셀에 새겨졌는지 본다.
 * 자막 구간과 비자막 구간의 하단 1/4 영역에서 밝은 픽셀 수를 센다.
 */
async function inspectBurnedSubtitle(context, baseUrl, installHelpers, bundleSource, bytes, mimeType) {
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await installHelpers(page)
  const result = await page.evaluate(
    async ([bundle, data, mime]) => {
      const url = URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }))
      const mb = await import(url)
      const blob = new Blob([new Uint8Array(data)], { type: mime })
      const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS })
      const track = await input.getPrimaryVideoTrack()
      const sink = new mb.VideoSampleSink(track)

      const countBright = async (timestamp) => {
        const sample = await sink.getSample(timestamp)
        if (!sample) return 0
        const canvas = document.createElement('canvas')
        canvas.width = sample.displayWidth
        canvas.height = sample.displayHeight
        const ctx = canvas.getContext('2d')
        sample.draw(ctx, 0, 0)
        sample.close()
        // 하단 1/4 만 본다. 자막은 아래쪽에 놓인다.
        const y = Math.floor(canvas.height * 0.72)
        const image = ctx.getImageData(0, y, canvas.width, canvas.height - y)
        let bright = 0
        for (let i = 0; i < image.data.length; i += 4) {
          if (image.data[i] > 200 && image.data[i + 1] > 200 && image.data[i + 2] > 200) bright += 1
        }
        return bright
      }

      const withSubtitle = await countBright(2)
      const withoutSubtitle = await countBright(3.6)
      input.dispose()
      return { withSubtitle, withoutSubtitle }
    },
    [bundleSource, Array.from(bytes), mimeType],
  )
  await page.close()
  return result
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
process.exit(failed.length > 0 || exitCode !== 0 ? 1 : 0)

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
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPreviewServer } from './server.mjs'
import zlib from 'node:zlib'

const { baseUrl: BASE_URL, stop: stopServer } = await startPreviewServer()

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

let browser
let exitCode = 0

try {
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
  // 세로로 찍은 영상. 가로 영상과 섞었을 때를 보기 위한 것이다.
  const portrait = await page.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 360,
        heightPx: 640,
        durationSec: 4,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )
  // 잔 무늬가 깔린 세로 영상. 흐리게 처리했는지는 원본이 선명해야 잴 수 있다.
  const checkered = await page.evaluate(
    ([bundle]) =>
      globalThis.__helpers.buildFixture({
        bundleSource: bundle,
        widthPx: 360,
        heightPx: 640,
        durationSec: 2,
        fps: 30,
        rotation: 0,
        pattern: 'checker',
      }),
    [bundleSource],
  )
  const photo = Array.from(makePng(160, 120))

  async function loadProject(entries) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate((list) => {
      const transfer = new DataTransfer()
      for (const entry of list) {
        transfer.items.add(
          new File([new Uint8Array(entry.bytes)], entry.name, { type: entry.type }),
        )
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
        Math.abs(
          Number(document.querySelector('[data-testid="playhead"]').dataset.seconds) - target,
        ) < 0.2,
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
    mixedInfo.audioDuration !== null &&
      Math.abs(mixedInfo.audioDuration - mixedInfo.duration) <= 0.3,
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
  await loadProject([
    { bytes: clip.bytes, name: `자막영상.${clip.extension}`, type: clip.mimeType },
  ])
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
  check(
    '자막 파일 이름이 .srt',
    subtitled.srtName?.endsWith('.srt') === true,
    String(subtitled.srtName),
  )

  const srt = await readFile(subtitled.srtPath, 'utf8')
  console.log('  srt:', JSON.stringify(srt))
  check(
    'AC-044 SRT 번호와 내용',
    srt.startsWith('1\n') && srt.includes('자막 확인'),
    srt.split('\n')[0],
  )
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

  // ---------- AC-016~019 출력 설정 ----------
  // 320×240(4:3) 영상으로 시작한다.
  await loadProject([
    { bytes: clip.bytes, name: `설정영상.${clip.extension}`, type: clip.mimeType },
  ])
  await page.locator('[data-testid="export-settings"]').scrollIntoViewIfNeeded()

  const outputSize = () => page.locator('[data-testid="output-size"]').innerText()
  const estimated = () => page.locator('[data-testid="estimated-size"]').innerText()

  // FR-016 기본 해상도는 원본을 키우지 않는다. 240p 원본은 목록의 최솟값인
  // 480p 가 되고, 1080p 기본값처럼 용량만 커지는 일이 없어야 한다.
  check(
    'FR-016 기본 해상도가 원본을 따라간다 (240p 원본 → 480p)',
    (await page.locator('[data-testid="resolution-480"]').getAttribute('aria-pressed')) === 'true',
    await outputSize(),
  )

  await page.click('[data-testid="resolution-480"]')
  check('AC-018 480p 선택 시 세로 480', (await outputSize()).endsWith('×480'), await outputSize())
  check(
    'AC-016 원본 그대로는 4:3 비율 유지',
    (await outputSize()) === '640×480',
    await outputSize(),
  )

  // 480p 아래로는 내려갈 수 없으므로 기본값에서 경고가 보이면 안 된다.
  // 반대로 사용자가 굳이 1080p 를 고르면 용량만 커진다고 알려야 한다.
  check(
    'FR-017 기본값에서는 확대 경고가 없다',
    (await page.locator('[data-testid="upscale-warning"]').count()) === 0,
  )
  await page.click('[data-testid="resolution-1080"]')
  check(
    'FR-017 원본보다 크게 고르면 경고가 뜬다',
    (await page.locator('[data-testid="upscale-warning"]').count()) === 1,
    (await page.locator('[data-testid="upscale-warning"]').count())
      ? await page.locator('[data-testid="upscale-warning"]').innerText()
      : '경고 없음',
  )
  await page.click('[data-testid="resolution-480"]')

  await page.click('[data-testid="aspect-9:16"]')
  check('AC-016 9:16 선택 시 세로로 길어짐', (await outputSize()) === '270×480', await outputSize())
  await page.click('[data-testid="aspect-1:1"]')
  check('AC-016 1:1 선택 시 정사각', (await outputSize()) === '480×480', await outputSize())
  await page.click('[data-testid="aspect-16:9"]')
  check('AC-016 16:9 선택 시 854×480', (await outputSize()) === '854×480', await outputSize())

  // AC-019 화질을 바꾸면 예상 용량이 즉시 바뀐다
  await page.click('[data-testid="quality-high"]')
  const highText = await estimated()
  await page.click('[data-testid="quality-low"]')
  const lowText = await estimated()
  const toBytes = (text) => {
    const [, value, unit] = text.match(/([\d.]+)\s*(B|KB|MB|GB)/) ?? []
    const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit] ?? 1
    return Number(value) * scale
  }
  check(
    'AC-019 화질을 낮추면 예상 용량이 줄어든다',
    toBytes(lowText) < toBytes(highText),
    `높음 ${highText} / 낮음 ${lowText}`,
  )

  // AC-018 실제 결과가 고른 해상도로 나온다 (9:16 + 잘라 채우기)
  await page.click('[data-testid="aspect-9:16"]')
  await page.click('[data-testid="fit-cover"]')
  await page.click('[data-testid="quality-medium"]')
  const expectedSize = await outputSize()
  const expectedBytes = toBytes(await estimated())

  const configured = await exportAndSave('configured')
  const configuredInfo = await inspect(configured.videoPath, clip.mimeType)
  check(
    'AC-016/018 결과 해상도가 설정과 일치',
    `${configuredInfo.width}×${configuredInfo.height}` === expectedSize,
    `${configuredInfo.width}×${configuredInfo.height} (설정 ${expectedSize})`,
  )

  // 예상 용량은 상한이다. 인코더는 장면이 단순하면 요청한 비트레이트를
  // 다 쓰지 않으므로 결과가 더 작게 나온다. 사용자에게 중요한 보장은
  // "예상보다 커지지 않는다" 쪽이다.
  const { size: actualBytes } = await stat(configured.videoPath)
  check(
    'AC-019 실제 용량이 예상값을 넘지 않는다',
    actualBytes <= expectedBytes * 1.1,
    `실제 ${(actualBytes / 1024).toFixed(0)}KB / 예상 ${(expectedBytes / 1024).toFixed(0)}KB`,
  )
  check('AC-019 결과 파일이 비어 있지 않다', actualBytes > 1024, `${actualBytes} B`)

  // AC-017 여백 채우기는 위아래에 검은 띠가 생기고, 잘라 채우기는 없다
  const letterbox = await measureLetterbox(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile(configured.videoPath),
    clip.mimeType,
  )
  check(
    'AC-017 잘라 채우기는 여백 없음',
    letterbox.darkRows <= 2,
    `위쪽 어두운 줄 ${letterbox.darkRows}개`,
  )

  await page.click('[data-testid="fit-contain"]')
  const contained = await exportAndSave('contained')
  const containedBox = await measureLetterbox(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile(contained.videoPath),
    clip.mimeType,
  )
  check(
    'AC-017 여백 채우기는 위아래에 검은 여백',
    containedBox.darkRows > 20,
    `위쪽 어두운 줄 ${containedBox.darkRows}개`,
  )

  // ---------- FR-015 흐린 배경 채우기 ----------
  // 세로로 찍은 영상을 16:9 로 내보내는 상황. 세 가지 방법이 실제로
  // 다른 결과를 내는지 픽셀로 확인한다.
  await loadProject([
    { bytes: portrait.bytes, name: `세로영상.${portrait.extension}`, type: portrait.mimeType },
  ])
  await page.locator('[data-testid="export-settings"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="aspect-16:9"]')
  await page.click('[data-testid="resolution-480"]')

  await page.click('[data-testid="fit-blur"]')
  const blurFill = await exportAndSave('blur-fill')
  const blurFrame = await measureFrame(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile(blurFill.videoPath),
    portrait.mimeType,
    1,
  )
  console.log('  흐린 배경:', JSON.stringify(blurFrame))
  check(
    'FR-015 흐린 배경 채우기는 좌우 여백이 없다',
    blurFrame.darkColumns <= 2,
    `왼쪽 어두운 세로줄 ${blurFrame.darkColumns}개`,
  )
  check(
    'FR-015 흐린 배경 채우기는 화면을 자르지 않는다',
    blurFrame.whitePixels > 0,
    `원본 좌상단 글자 픽셀 ${blurFrame.whitePixels}개`,
  )
  check(
    'FR-015 채운 배경이 본 화면보다 흐리다',
    blurFrame.edgeDetail < blurFrame.centerDetail,
    `가장자리 ${blurFrame.edgeDetail.toFixed(2)} vs 가운데 ${blurFrame.centerDetail.toFixed(2)}`,
  )

  await page.click('[data-testid="fit-cover"]')
  const coverFill = await exportAndSave('cover-fill')
  const coverFrame = await measureFrame(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile(coverFill.videoPath),
    portrait.mimeType,
    1,
  )
  check(
    'FR-015 잘라 채우기는 위아래가 잘린다',
    coverFrame.whitePixels === 0 && coverFrame.darkColumns <= 2,
    `글자 픽셀 ${coverFrame.whitePixels}개, 어두운 세로줄 ${coverFrame.darkColumns}개`,
  )

  await page.click('[data-testid="fit-contain"]')
  const containFill = await exportAndSave('contain-fill')
  const containFrame = await measureFrame(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile(containFill.videoPath),
    portrait.mimeType,
    1,
  )
  check(
    'FR-015 여백 채우기는 좌우에 검은 여백이 남는다',
    containFrame.darkColumns > 20,
    `왼쪽 어두운 세로줄 ${containFrame.darkColumns}개`,
  )

  // 위 검사는 평평한 배경으로도 통과한다. 블러를 빼먹어도 흐려 보이므로,
  // 잔 무늬가 깔린 영상으로 "실제로 흐려졌는지"를 따로 잰다. 같은 영상을
  // 잘라 채우기로 내보낸 것과 비교해야 숫자에 의미가 생긴다.
  await loadProject([
    { bytes: checkered.bytes, name: `무늬세로.${checkered.extension}`, type: checkered.mimeType },
  ])
  await page.locator('[data-testid="export-settings"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="aspect-16:9"]')
  await page.click('[data-testid="resolution-480"]')

  await page.click('[data-testid="fit-blur"]')
  const checkerBlur = await measureFrame(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile((await exportAndSave('checker-blur')).videoPath),
    checkered.mimeType,
    1,
  )
  await page.click('[data-testid="fit-cover"]')
  const checkerCover = await measureFrame(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile((await exportAndSave('checker-cover')).videoPath),
    checkered.mimeType,
    1,
  )
  console.log(
    '  무늬 영상 가장자리 선명도:',
    `흐린 배경 ${checkerBlur.edgeDetail.toFixed(2)} / 잘라 채우기 ${checkerCover.edgeDetail.toFixed(2)}`,
  )
  check(
    'FR-015 채운 배경이 실제로 흐려졌다 (잘라 채우기의 절반 이하)',
    checkerBlur.edgeDetail < checkerCover.edgeDetail * 0.5,
    `흐린 배경 ${checkerBlur.edgeDetail.toFixed(2)} vs 잘라 채우기 ${checkerCover.edgeDetail.toFixed(2)}`,
  )

  // 세로 영상과 가로 영상을 한 타임라인에 섞은 경우. '원본 그대로'여도
  // 맞추는 방법이 결과를 바꾸므로 선택이 보여야 하고, 기본값이 적용돼야 한다.
  await loadProject([
    { bytes: clip.bytes, name: `가로영상.${clip.extension}`, type: clip.mimeType },
    { bytes: portrait.bytes, name: `세로영상.${portrait.extension}`, type: portrait.mimeType },
  ])
  await page.locator('[data-testid="export-settings"]').scrollIntoViewIfNeeded()
  check(
    'FR-015 화면비가 다른 클립이 섞이면 맞추는 방법이 보인다',
    (await page.locator('[data-testid="fit-blur"]').count()) === 1,
  )
  check(
    'FR-015 기본값이 흐린 배경 채우기',
    (await page.locator('[data-testid="fit-blur"]').getAttribute('aria-pressed')) === 'true',
  )

  const mixedFill = await exportAndSave('mixed-fill')
  // 가로 영상이 4초, 그다음이 세로 영상 구간이다.
  const mixedFrame = await measureFrame(
    context,
    BASE_URL,
    installHelpers,
    bundleSource,
    await readFile(mixedFill.videoPath),
    clip.mimeType,
    5,
  )
  console.log('  섞인 타임라인의 세로 구간:', JSON.stringify(mixedFrame))
  check(
    'FR-015 섞인 타임라인에서 세로 구간이 가로 화면을 꽉 채운다',
    mixedFrame.darkColumns <= 2,
    `왼쪽 어두운 세로줄 ${mixedFrame.darkColumns}개`,
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
  stopServer()
}

/**
 * 위쪽에서 몇 줄이 거의 검은색인지 센다. 여백 채우기면 띠가 생긴다.
 */
async function measureLetterbox(context, baseUrl, installHelpers, bundleSource, bytes, mimeType) {
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
      const sample = await sink.getSample(1)
      const canvas = document.createElement('canvas')
      canvas.width = sample.displayWidth
      canvas.height = sample.displayHeight
      const ctx = canvas.getContext('2d')
      sample.draw(ctx, 0, 0)
      sample.close()

      let darkRows = 0
      for (let y = 0; y < Math.floor(canvas.height / 2); y += 1) {
        const row = ctx.getImageData(0, y, canvas.width, 1).data
        let bright = 0
        for (let i = 0; i < row.length; i += 4) {
          if (row[i] > 24 || row[i + 1] > 24 || row[i + 2] > 24) bright += 1
        }
        if (bright > canvas.width * 0.02) break
        darkRows += 1
      }
      input.dispose()
      return { darkRows, width: canvas.width, height: canvas.height }
    },
    [bundleSource, Array.from(bytes), mimeType],
  )
  await page.close()
  return result
}

/**
 * 한 프레임을 꺼내 채우기 방식이 실제로 다른지 본다.
 *
 * - darkColumns: 왼쪽에서 거의 검은 세로줄 수. 여백 채우기면 띠가 남는다.
 * - whitePixels: 원본 좌상단의 흰 글자 픽셀 수. 잘라 채우기는 위아래가
 *   잘려 글자가 사라진다.
 * - edgeDetail / centerDetail: 가로 방향 밝기 변화량의 평균. 흐린 배경은
 *   본 화면보다 변화가 작다. 선명한 복사로 채우면 이 값이 비슷해진다.
 */
async function measureFrame(
  context,
  baseUrl,
  installHelpers,
  bundleSource,
  bytes,
  mimeType,
  time = 1,
) {
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await installHelpers(page)
  const result = await page.evaluate(
    async ([bundle, data, mime, at]) => {
      const url = URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }))
      const mb = await import(url)
      const blob = new Blob([new Uint8Array(data)], { type: mime })
      const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS })
      const track = await input.getPrimaryVideoTrack()
      const sink = new mb.VideoSampleSink(track)
      const sample = await sink.getSample(at)
      const canvas = document.createElement('canvas')
      canvas.width = sample.displayWidth
      canvas.height = sample.displayHeight
      const ctx = canvas.getContext('2d')
      sample.draw(ctx, 0, 0)
      sample.close()

      const { width, height } = canvas
      const pixels = ctx.getImageData(0, 0, width, height).data
      const luma = (i) => 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]

      let darkColumns = 0
      for (let x = 0; x < Math.floor(width / 2); x += 1) {
        let bright = 0
        for (let y = 0; y < height; y += 1) {
          const i = (y * width + x) * 4
          if (pixels[i] > 24 || pixels[i + 1] > 24 || pixels[i + 2] > 24) bright += 1
        }
        if (bright > height * 0.02) break
        darkColumns += 1
      }

      // 흰 글자만 센다. 파란 사각형(56,189,248)은 빨강이 낮아 걸리지 않는다.
      let whitePixels = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 150 && pixels[i + 1] > 150 && pixels[i + 2] > 150) whitePixels += 1
      }

      const detail = (fromX, toX) => {
        let sum = 0
        let count = 0
        for (let y = 0; y < height; y += 2) {
          for (let x = fromX; x < toX - 1; x += 1) {
            sum += Math.abs(luma((y * width + x + 1) * 4) - luma((y * width + x) * 4))
            count += 1
          }
        }
        return count > 0 ? sum / count : 0
      }

      input.dispose()
      return {
        width,
        height,
        darkColumns,
        whitePixels,
        edgeDetail: detail(0, Math.floor(width * 0.12)),
        centerDetail: detail(Math.floor(width * 0.35), Math.floor(width * 0.65)),
      }
    },
    [bundleSource, Array.from(bytes), mimeType, time],
  )
  await page.close()
  return result
}

/**
 * 자막이 실제로 픽셀에 새겨졌는지 본다.
 * 자막 구간과 비자막 구간의 하단 1/4 영역에서 밝은 픽셀 수를 센다.
 */
async function inspectBurnedSubtitle(
  context,
  baseUrl,
  installHelpers,
  bundleSource,
  bytes,
  mimeType,
) {
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

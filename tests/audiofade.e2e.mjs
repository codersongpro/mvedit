/**
 * 컷 사이 페이드와 음원(MP3) 편집·내보내기 자동 검증.
 *
 * 페이드  클립 사이 페이드가 타임라인·미리보기·내보낸 화면·내보낸 소리에 모두 반영된다
 * 음원    MP3 를 올려 자르고 이어 붙여 MP3 로 내보낸다. 영상과 섞어도 소리가 들어간다
 *
 *   npm run build && npm run test:audiofade
 */
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { startPreviewServer } from './server.mjs'

const { baseUrl: BASE_URL, stop: stopServer } = await startPreviewServer()

const here = fileURLToPath(new URL('.', import.meta.url))
const bundlePath = join(here, '..', 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs')

/** 단색 PNG. 화면이 평평해야 평균 밝기로 페이드를 잴 수 있다. */
function makePng(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const start = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      raw[start + 1 + x * 3] = r
      raw[start + 2 + x * 3] = g
      raw[start + 3 + x * 3] = b
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
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

/** 440Hz 사인파 WAV(16비트 모노 44.1kHz). MP3 를 만들 도구가 없어 앱의 내보내기로 MP3 를 얻는다. */
function makeWav(seconds, amplitude) {
  const rate = 44100
  const frames = Math.round(rate * seconds)
  const buffer = Buffer.alloc(44 + frames * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + frames * 2, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i += 1) {
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amplitude * 32767),
      44 + i * 2,
    )
  }
  return buffer
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
  const workDir = await mkdtemp(join(tmpdir(), 'cutcap-audiofade-'))

  browser = await chromium.launch()
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 1200 })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  const installHelpers = (target) =>
    target.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      globalThis.__helpers = await import(url)
    }, helpers)

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await installHelpers(page)

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
  const white = Array.from(makePng(160, 120, [255, 255, 255]))
  const wav4 = Array.from(makeWav(4, 0.5))

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
  const selectClip = (index) =>
    page
      .locator('[data-testid="clip"]')
      .nth(index)
      .click({ position: { x: 30, y: 20 } })
  const count = (testId) => page.locator(`[data-testid="${testId}"]`).count()

  /** range 입력은 값을 직접 넣고 input 이벤트를 보내야 리액트가 받는다. */
  async function setRange(testId, value) {
    await page.$eval(
      `[data-testid="${testId}"]`,
      (node, next) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(node, String(next))
        node.dispatchEvent(new Event('input', { bubbles: true }))
      },
      value,
    )
  }

  async function exportAndSave(label) {
    await page.locator('[data-testid="export-button"]').scrollIntoViewIfNeeded()
    await page.click('[data-testid="export-button"]')
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 240_000 })
    const name = await page.getAttribute('[data-testid="download-link"]', 'download')
    const pending = page.waitForEvent('download')
    await page.click('[data-testid="download-link"]')
    const path = join(workDir, label)
    await (await pending).saveAs(path)
    return { path, name }
  }

  async function inWorkerPage(fn, args) {
    const verifier = await context.newPage()
    await verifier.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await installHelpers(verifier)
    const result = await verifier.evaluate(fn, args)
    await verifier.close()
    return result
  }
  const peakBetween = (info, from, to) => {
    const inRange = info.audioEnergy.filter((b) => b.t >= from && b.t < to)
    return inRange.length === 0 ? 0 : Math.max(...inRange.map((b) => b.peak))
  }

  // ---------- 컷 사이 페이드: 화면 ----------
  // 흰 사진 두 장(3초씩). 사이에 0.5초 페이드를 걸면 이음매 근처만 어두워진다.
  await loadProject([
    { bytes: white, name: '사진1.png', type: 'image/png' },
    { bytes: white, name: '사진2.png', type: 'image/png' },
  ])
  await selectClip(0)
  check('페이드 슬라이더가 클립 속성에 보인다', (await count('fade-in-slider')) === 1)
  check(
    '처음엔 타임라인에 페이드 표시가 없다',
    (await count('clip-fade-in')) + (await count('clip-fade-out')) === 0,
  )

  await page.click('[data-testid="seam-fade-toggle"]')
  await page.waitForSelector('[data-testid="clip-fade-out"]')
  check(
    '모든 컷 사이 페이드: 이음매에만 걸린다 (앞 클립 끝 1, 뒤 클립 시작 1)',
    (await count('clip-fade-out')) === 1 && (await count('clip-fade-in')) === 1,
  )
  check(
    '앞 클립에는 페이드 아웃, 뒤 클립에는 페이드 인',
    (await page
      .locator('[data-testid="clip"]')
      .nth(0)
      .locator('[data-testid="clip-fade-out"]')
      .count()) === 1 &&
      (await page
        .locator('[data-testid="clip"]')
        .nth(1)
        .locator('[data-testid="clip-fade-in"]')
        .count()) === 1,
  )

  // 미리보기: 이음매 직전에는 검은 막이 덮이고, 한가운데는 없다.
  await seekTo(2.9)
  const fadeOpacity = await page.$eval('[data-testid="preview-fade"]', (node) =>
    Number(node.style.opacity),
  )
  check('미리보기: 페이드 구간에서 화면이 어두워진다', fadeOpacity > 0.5, `불투명도 ${fadeOpacity}`)
  await seekTo(1.5)
  check('미리보기: 페이드 밖에서는 그대로다', (await count('preview-fade')) === 0)

  const photos = await exportAndSave('photos')
  const brightness = await inWorkerPage(
    async ([bundle, data, times]) =>
      globalThis.__helpers.sampleBrightness({
        bundleSource: bundle,
        bytes: data,
        mimeType: 'video/webm',
        times,
      }),
    [bundleSource, Array.from(await readFile(photos.path)), [1.0, 2.95, 3.05, 5.0]],
  )
  console.log('  밝기:', brightness.map((value) => value.toFixed(0)).join(' / '))
  check('내보낸 화면: 페이드 밖은 밝다', brightness[0] > 200 && brightness[3] > 200)
  check('내보낸 화면: 이음매 앞뒤로 어두워진다', brightness[1] < 100 && brightness[2] < 100)

  // 토글을 다시 누르면 모두 걷힌다.
  await selectClip(0)
  await page.click('[data-testid="seam-fade-toggle"]')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-fade-out"]').length === 0,
  )
  check('다시 누르면 페이드가 모두 빠진다', (await count('clip-fade-in')) === 0)

  // ---------- 컷 사이 페이드: 소리 ----------
  await loadProject([
    { bytes: clip.bytes, name: `앞.${clip.extension}`, type: clip.mimeType },
    { bytes: clip.bytes, name: `뒤.${clip.extension}`, type: clip.mimeType },
  ])
  await selectClip(0)
  await page.click('[data-testid="seam-fade-toggle"]')
  await page.waitForSelector('[data-testid="clip-fade-out"]')
  const videos = await exportAndSave('videos')
  const videoInfo = await inWorkerPage(
    ([bundle, data, mime]) =>
      globalThis.__helpers.inspectFile({ bundleSource: bundle, bytes: data, mimeType: mime }),
    [bundleSource, Array.from(await readFile(videos.path)), clip.mimeType],
  )
  const mid = peakBetween(videoInfo, 1, 3)
  const beforeSeam = peakBetween(videoInfo, 3.9, 4.0)
  const afterSeam = peakBetween(videoInfo, 4.0, 4.1)
  console.log('  소리 최대치:', JSON.stringify({ mid, beforeSeam, afterSeam }))
  check('내보낸 소리: 페이드 밖은 그대로다', mid > 0.15, mid.toFixed(3))
  check('내보낸 소리: 이음매 앞에서 잦아든다', beforeSeam < mid * 0.5, beforeSeam.toFixed(3))
  check('내보낸 소리: 이음매 뒤에서 커진다', afterSeam < mid * 0.5, afterSeam.toFixed(3))
  check(
    '페이드를 걸어도 총 길이는 그대로 (겹치지 않는다)',
    Math.abs(videoInfo.duration - 8) <= 0.3,
    `${videoInfo.duration.toFixed(2)}초`,
  )

  // 분할하면 자른 자리에는 페이드를 두지 않는다 (한 장면 중간이 어두워지면 안 된다).
  await seekTo(2)
  await page.click('[data-testid="split"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 3)
  check(
    '분할: 원래 클립의 페이드 아웃은 뒤 조각에만 남는다',
    (await count('clip-fade-out')) === 1 && (await count('clip-fade-in')) === 1,
  )

  // ---------- MP3: 올리기·편집 ----------
  await loadProject([{ bytes: wav4, name: '소리.wav', type: 'audio/wav' }])
  check('음원이 클립으로 들어온다', (await page.locator('[data-clip-type="audio"]').count()) === 1)
  check('미리보기에 음원 표시', (await count('preview-audio')) === 1)
  check('음원만 있으면 화면 설정이 숨는다', (await count('export-settings')) === 0)
  const buttonText = await page.locator('[data-testid="export-button"]').innerText()
  check('내보내기 버튼이 MP3 로 바뀐다', buttonText.includes('MP3'), buttonText)
  check(
    '자막 추가는 음원에서 막힌다',
    await page.locator('[data-testid="add-subtitle"]').isDisabled(),
  )

  // 4초를 2초 지점에서 나눠 앞 조각을 지우면 뒤 2초만 남는다. 거기에 앞 0.5초·뒤 1초 페이드.
  await seekTo(2)
  await page.click('[data-testid="split"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
  await selectClip(0)
  await page.click('[data-testid="delete"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1)
  await selectClip(0)
  await setRange('fade-in-slider', 0.5)
  await setRange('fade-out-slider', 1)
  await page.waitForSelector('[data-testid="clip-fade-out"]')

  const mp3 = await exportAndSave('edited.mp3')
  check('저장 파일 이름이 .mp3', mp3.name?.endsWith('_cutcap.mp3') === true, String(mp3.name))
  const mp3Info = await inWorkerPage(
    ([bundle, data]) =>
      globalThis.__helpers.inspectAudioFile({
        bundleSource: bundle,
        bytes: data,
        mimeType: 'audio/mpeg',
      }),
    [bundleSource, Array.from(await readFile(mp3.path))],
  )
  console.log('  MP3:', JSON.stringify({ ...mp3Info, audioEnergy: undefined }))
  check('결과가 MP3 코덱이다', mp3Info.codec === 'mp3', String(mp3Info.codec))
  check('영상 트랙이 없다', mp3Info.hasVideo === false)
  check(
    '길이가 편집한 2초와 같다',
    Math.abs(mp3Info.duration - 2) <= 0.2,
    `${mp3Info.duration.toFixed(2)}초`,
  )
  const head = peakBetween(mp3Info, 0, 0.1)
  const body = peakBetween(mp3Info, 0.6, 0.95)
  const tail = peakBetween(mp3Info, 1.9, 3)
  console.log('  MP3 소리:', JSON.stringify({ head, body, tail }))
  check('MP3: 가운데는 원음 크기다', body > 0.35, body.toFixed(3))
  check('MP3: 시작은 페이드 인으로 작다', head < 0.2, head.toFixed(3))
  check('MP3: 끝은 페이드 아웃으로 작다', tail < 0.2, tail.toFixed(3))

  // ---------- MP3 를 다시 올려 두 개를 이어 붙인다 ----------
  const mp3Bytes = Array.from(await readFile(mp3.path))
  await loadProject([
    { bytes: mp3Bytes, name: '가.mp3', type: 'audio/mpeg' },
    { bytes: mp3Bytes, name: '나.mp3', type: 'audio/mpeg' },
  ])
  check(
    'MP3 파일도 음원 클립으로 읽힌다',
    (await page.locator('[data-clip-type="audio"]').count()) === 2,
  )
  const merged = await exportAndSave('merged.mp3')
  const mergedInfo = await inWorkerPage(
    ([bundle, data]) =>
      globalThis.__helpers.inspectAudioFile({
        bundleSource: bundle,
        bytes: data,
        mimeType: 'audio/mpeg',
      }),
    [bundleSource, Array.from(await readFile(merged.path))],
  )
  check(
    '두 MP3 를 이어 붙인 길이',
    Math.abs(mergedInfo.duration - 4) <= 0.3,
    `${mergedInfo.duration.toFixed(2)}초`,
  )

  // ---------- 영상과 음원을 섞으면 검은 화면에 소리만 흐른다 ----------
  await loadProject([
    { bytes: clip.bytes, name: `영상.${clip.extension}`, type: clip.mimeType },
    { bytes: wav4, name: '배경.wav', type: 'audio/wav' },
  ])
  check(
    '영상과 음원이 섞이면 영상 내보내기로 남는다',
    (await page.locator('[data-testid="export-button"]').innerText()).includes('영상'),
  )
  const mixed = await exportAndSave('mixed')
  const mixedInfo = await inWorkerPage(
    ([bundle, data, mime]) =>
      globalThis.__helpers.inspectFile({ bundleSource: bundle, bytes: data, mimeType: mime }),
    [bundleSource, Array.from(await readFile(mixed.path)), clip.mimeType],
  )
  check(
    '섞인 프로젝트 길이 8초',
    Math.abs(mixedInfo.duration - 8) <= 0.3,
    `${mixedInfo.duration.toFixed(2)}초`,
  )
  const audioPart = peakBetween(mixedInfo, 5, 7)
  check('섞인 프로젝트: 음원 구간에 소리가 있다', audioPart > 0.3, audioPart.toFixed(3))

  check('페이지 오류 없음', pageErrors.length === 0, pageErrors.join(' | '))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  await browser?.close()
  await stopServer()
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`)
process.exit(failed.length > 0 || exitCode !== 0 ? 1 : 0)

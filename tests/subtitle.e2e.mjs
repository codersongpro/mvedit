/**
 * Phase 7 자동 검증 — 자막 (FR-033~036).
 *
 * AC-037 구간에 자막을 넣으면 그 구간에만 보인다
 * AC-038 수정·삭제가 즉시 반영된다
 * AC-039 재생헤드 위치에서 자막이 생긴다
 * AC-040 클립을 옮기면 자막이 따라간다
 * AC-041 클립을 자르면 자막도 경계에서 나뉘고, 트림으로 밀려나면 숨는다
 * AC-042 모양 설정이 모든 자막에 적용된다
 * (AC-043 굽기, AC-044 .srt 는 내보내기가 붙는 Phase 8)
 *
 *   npm run build && npm run test:subtitle
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 4189)
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } })
  const pageErrors = []
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
        durationSec: 10,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )

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
  const overlayText = async () =>
    (await page.locator('[data-testid="subtitle-overlay"]').count())
      ? (await page.locator('[data-testid="subtitle-overlay"]').innerText()).trim()
      : null
  const rowCount = () => page.locator('[data-testid="subtitle-row"]').count()
  const rowTimes = () =>
    page.$$eval('[data-testid="subtitle-seek"]', (nodes) => nodes.map((n) => n.textContent.trim()))

  // ---------- AC-039 / AC-037 ----------
  await load([`가.${clip.extension}`])
  await seekTo(2)
  await page.click('[data-testid="add-subtitle"]')
  check('AC-039 재생헤드 위치에 자막이 생김', (await rowCount()) === 1)
  check('AC-039 자막 시각이 재생헤드와 일치', (await rowTimes())[0] === '00:02', (await rowTimes())[0])

  await page.fill('[data-testid="subtitle-text"]', '안녕하세요')
  check('AC-038 입력이 미리보기에 즉시 반영', (await overlayText()) === '안녕하세요', String(await overlayText()))

  await seekTo(5)
  check('AC-037 자막 구간 밖에서는 보이지 않음', (await overlayText()) === null, String(await overlayText()))
  await seekTo(2.5)
  check('AC-037 자막 구간 안에서 다시 보임', (await overlayText()) === '안녕하세요', String(await overlayText()))

  // ---------- AC-042 모양 ----------
  await page.click('[data-testid="subtitle-style"] summary')
  await page.click('[data-testid="font-크게"]')
  const bigFont = await page.$eval('[data-testid="subtitle-overlay"] span', (node) =>
    parseFloat(getComputedStyle(node).fontSize),
  )
  await page.click('[data-testid="font-작게"]')
  const smallFont = await page.$eval('[data-testid="subtitle-overlay"] span', (node) =>
    parseFloat(getComputedStyle(node).fontSize),
  )
  check('AC-042 글자 크기 설정이 반영됨', bigFont > smallFont, `크게 ${bigFont}px > 작게 ${smallFont}px`)

  await page.click('[data-testid="subtitle-color-FFE066"]')
  const color = await page.$eval('[data-testid="subtitle-overlay"] span', (node) =>
    getComputedStyle(node).color,
  )
  check('AC-042 글자색 설정이 반영됨', color === 'rgb(255, 224, 102)', color)

  await page.click('[data-testid="bg-box"]')
  const boxBg = await page.$eval('[data-testid="subtitle-overlay"] span', (node) =>
    getComputedStyle(node).backgroundColor,
  )
  check('AC-042 배경상자 설정이 반영됨', boxBg.startsWith('rgba(0, 0, 0'), boxBg)

  // ---------- AC-041 자르면 자막도 나뉜다 ----------
  // 2~4초 자막 한가운데(3초)에서 자른다.
  await seekTo(3)
  await page.click('[data-testid="split"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
  check('AC-041 경계에 걸친 자막이 둘로 나뉨', (await rowCount()) === 2, `${await rowCount()}개`)
  const texts = await page.$$eval('[data-testid="subtitle-text"]', (nodes) => nodes.map((n) => n.value))
  check('AC-041 나뉜 자막 내용이 유지됨', texts.join('|') === '안녕하세요|안녕하세요', texts.join('|'))
  await seekTo(2.5)
  check('AC-041 자르기 전과 같은 시점에 그대로 보임', (await overlayText()) === '안녕하세요')
  await seekTo(3.5)
  check('AC-041 자른 뒤 구간에서도 이어서 보임', (await overlayText()) === '안녕하세요')

  // ---------- AC-040 클립을 옮기면 자막도 따라간다 ----------
  await load([`가.${clip.extension}`, `나.${clip.extension}`])
  await seekTo(12) // 두 번째 클립 안 (10~20초)
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '두번째')
  check('AC-040 준비: 12초에 자막', (await rowTimes())[0] === '00:12', (await rowTimes())[0])

  await page.locator('[data-testid="clip"]').nth(1).click()
  await page.click('[data-testid="move-back"]')
  check('AC-040 클립을 앞으로 옮기면 자막도 따라감', (await rowTimes())[0] === '00:02', (await rowTimes())[0])
  await seekTo(2)
  check('AC-040 옮긴 위치에서 자막이 보임', (await overlayText()) === '두번째', String(await overlayText()))

  // ---------- 트림으로 밀려나면 숨는다 ----------
  await load([`가.${clip.extension}`])
  await seekTo(8)
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '뒤쪽자막')
  await page.locator('[data-testid="clip"]').click()
  await page.locator('[data-testid="trim-end"]').scrollIntoViewIfNeeded()
  const handle = await page.locator('[data-testid="trim-end"]').boundingBox()
  const px = await scale()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 4; i += 1) {
    await page.mouse.move(handle.x + handle.width / 2 - (5 * px * i) / 4, handle.y + handle.height / 2)
  }
  await page.mouse.up()
  check(
    'AC-041 트림으로 밀려난 자막은 숨김 표시',
    (await page.getAttribute('[data-testid="subtitle-row"]', 'data-hidden')) === 'true',
  )
  check('AC-041 자막이 지워지지는 않음', (await rowCount()) === 1)
  await page.click('[data-testid="undo"]')
  check(
    'AC-041 되돌리면 다시 나타남',
    (await page.getAttribute('[data-testid="subtitle-row"]', 'data-hidden')) === 'false',
  )

  // ---------- AC-038 삭제 ----------
  await page.click('[data-testid="subtitle-remove"]')
  check('AC-038 자막 삭제', (await rowCount()) === 0)
  await page.click('[data-testid="undo"]')
  check('AC-038 되돌리기로 자막 복원', (await rowCount()) === 1)

  // ---------- 클립을 지우면 자막도 사라진다 ----------
  await page.locator('[data-testid="clip"]').click()
  await page.click('[data-testid="delete"]')
  check('클립을 지우면 그 자막도 사라짐', (await rowCount()) === 0)

  // ---------- 타임라인에서 자막 길이 조절 ----------
  await load([`가.${clip.extension}`])
  await seekTo(2)
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '끌어서 조절')

  check('자막이 타임라인에 표시됨', (await page.locator('[data-testid="subtitle-block"]').count()) === 1)
  check(
    '새 자막은 바로 선택돼 손잡이가 보인다',
    (await page.locator('[data-testid="subtitle-trim-end"]').count()) === 1,
  )

  const blockEnd = () =>
    page.$eval('[data-testid="subtitle-block"]', (node) => Number(node.dataset.end))
  const blockStart = () =>
    page.$eval('[data-testid="subtitle-block"]', (node) => Number(node.dataset.start))

  /** 자막 손잡이를 끌어 시각을 옮긴다. */
  async function dragSubtitle(edge, deltaSeconds) {
    const selector = `[data-testid="subtitle-trim-${edge}"]`
    await page.locator(selector).scrollIntoViewIfNeeded()
    const box = await page.locator(selector).boundingBox()
    const px = await scale()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 4; i += 1) {
      await page.mouse.move(x + (deltaSeconds * px * i) / 4, y)
    }
    await page.mouse.up()
  }

  const beforeEnd = await blockEnd()
  await dragSubtitle('end', 2)
  check(
    '끝 손잡이를 끌면 자막이 길어진다',
    (await blockEnd()) - beforeEnd > 1.5,
    `${beforeEnd.toFixed(2)} → ${(await blockEnd()).toFixed(2)}초`,
  )
  check(
    '길이 입력란도 함께 갱신된다',
    Number(await page.inputValue('[data-testid="subtitle-duration"]')) > 3.5,
    await page.inputValue('[data-testid="subtitle-duration"]'),
  )

  const beforeStart = await blockStart()
  await dragSubtitle('start', 1)
  check(
    '시작 손잡이를 끌면 시작이 밀린다',
    (await blockStart()) - beforeStart > 0.5,
    `${beforeStart.toFixed(2)} → ${(await blockStart()).toFixed(2)}초`,
  )

  await page.click('[data-testid="undo"]')
  check(
    '자막 길이 조절도 되돌릴 수 있다',
    Math.abs((await blockStart()) - beforeStart) < 0.1,
    `${(await blockStart()).toFixed(2)}초`,
  )

  // 클립 범위를 넘지 않는다 (10초 클립)
  await dragSubtitle('end', 30)
  check('자막이 클립 끝을 넘지 않는다', (await blockEnd()) <= 10.01, `${(await blockEnd()).toFixed(2)}초`)

  // ---------- 도움말 / 버튼 이름 ----------
  check(
    '긴 조작 설명이 화면에서 사라짐',
    !(await page.content()).includes('눈금이나 클립을 눌러 위치를 옮기고 자르세요'),
  )
  check('도움말이 기본으로 닫혀 있음', (await page.locator('[data-testid="help-panel"]').count()) === 0)
  await page.click('[data-testid="help-toggle"]')
  const help = await page.locator('[data-testid="help-panel"]').innerText()
  check('도움말에 단축키 안내가 있음', help.includes('Space') && help.includes('Ctrl+Z'), help.split('\n')[0])
  check('도움말에 조작법 안내가 있음', help.includes('두 손가락'))

  check(
    '내보내기 버튼 이름이 영상 내보내기',
    (await page.locator('[data-testid="export-button"]').innerText()).trim() === '영상 내보내기',
    (await page.locator('[data-testid="export-button"]').innerText()).trim(),
  )
  check(
    '제목이 누구나 하는 컷편집과 자막넣기',
    (await page.locator('h1').innerText()).trim() === '누구나 하는 컷편집과 자막넣기',
    (await page.locator('h1').innerText()).trim(),
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

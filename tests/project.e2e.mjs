/**
 * Phase 11 자동 검증 — 자동 저장·복원, 프로젝트 목록 (FR-023, 026, 031).
 *
 * AC-026 편집 후 탭을 닫았다 다시 열면 목록에 있고, 열면 편집 상태가 복원된다.
 * AC-030 저장공간이 부족하면 자동 저장 전에 경고가 뜨고 앱은 계속 동작한다.
 * AC-035 이름을 바꾸고 다른 하나를 지우면 원본 사본까지 사라진다.
 *
 *   npm run build && npm run test:project
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

let browser
let exitCode = 0
const pageErrors = []

try {
  const { chromium } = await loadPlaywright()
  const bundleSource = await readFile(bundlePath, 'utf8')
  const helpers = await readFile(join(here, 'fixture.js'), 'utf8')

  browser = await chromium.launch()
  // 저장소는 컨텍스트마다 따로다. 한 컨텍스트를 끝까지 써야 "탭을 닫았다
  // 다시 열었다"를 흉내 낼 수 있다.
  const context = await browser.newContext()
  const page = await context.newPage({ viewport: { width: 1280, height: 1100 } })
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log('[브라우저]', m.text().slice(0, 200))
  })

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
        durationSec: 3,
        fps: 30,
        rotation: 0,
      }),
    [bundleSource],
  )

  async function addFiles(names) {
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
      (count) => document.querySelectorAll('[data-testid="clip"]').length >= count,
      names.length,
      { timeout: 60_000 },
    )
  }

  /**
   * 자동 저장은 디바운스가 있다. 저장이 끝난 것을 저장소에서 직접 확인한다.
   *
   * waitForFunction 에 async 함수를 넘기면 안 된다. 돌아온 Promise 자체가
   * 참으로 취급돼 첫 판에 바로 통과해 버린다. 여기서 실제로 그 함정에 빠져
   * 저장 전에 새로고침하는 바람에 한참 헤맸다.
   */
  async function waitForSave(name, expectedClips) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const saved = await page.evaluate(
        async ([projectName, count]) => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('cutcap')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          try {
            const projects = await new Promise((resolve, reject) => {
              const request = db.transaction('projects').objectStore('projects').getAll()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            })
            return projects.some(
              (project) => project.name === projectName && project.timeline.length === count,
            )
          } finally {
            db.close()
          }
        },
        [name, expectedClips],
      )
      if (saved) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('자동 저장이 끝나지 않았습니다')
  }

  const storedCounts = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('cutcap')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const all = (store) =>
        new Promise((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      try {
        const [projects, media] = await Promise.all([all('projects'), all('media')])
        return {
          projects: projects.length,
          media: media.length,
          names: projects.map((project) => project.name),
        }
      } finally {
        db.close()
      }
    })

  // ---------- AC-026 편집 후 다시 접속하면 복원된다 ----------
  await addFiles([`수업영상.${clip.extension}`, `보충영상.${clip.extension}`])
  check(
    '첫 파일을 넣으면 프로젝트 이름이 생긴다',
    (await page.inputValue('[data-testid="project-name"]')) === '수업영상',
    await page.inputValue('[data-testid="project-name"]'),
  )

  // 편집: 두 번째 클립을 지우고 자막을 하나 넣는다.
  await page.locator('[data-testid="clip"]').nth(1).click()
  await page.click('[data-testid="delete"]')
  await page.click('[data-testid="add-subtitle"]')
  await page.fill('[data-testid="subtitle-text"]', '복원 확인')
  await waitForSave('수업영상', 1)

  const beforeDuration = await page.locator('[data-testid="timeline-duration"]').innerText()

  // 탭을 닫았다 다시 여는 것과 같다. 저장소만 남는다.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="project-list"]', { timeout: 15_000 })
  check(
    'AC-026 다시 접속하면 목록에 프로젝트가 있다',
    (await page.locator('[data-testid="project-item"]').count()) === 1,
  )
  check(
    'AC-026 새로고침 직후에는 타임라인이 비어 있다',
    (await page.locator('[data-testid="clip"]').count()) === 0,
  )

  await page.click('[data-testid="project-open"]')
  await page.waitForSelector('[data-testid="clip"]', { timeout: 20_000 })
  check(
    'AC-026 클립 수가 복원된다',
    (await page.locator('[data-testid="clip"]').count()) === 1,
    `${await page.locator('[data-testid="clip"]').count()}개`,
  )
  check(
    'AC-026 전체 길이가 복원된다',
    (await page.locator('[data-testid="timeline-duration"]').innerText()) === beforeDuration,
    `${await page.locator('[data-testid="timeline-duration"]').innerText()} / 저장 전 ${beforeDuration}`,
  )
  check(
    'AC-026 자막이 복원된다',
    (await page.inputValue('[data-testid="subtitle-text"]')) === '복원 확인',
    await page.inputValue('[data-testid="subtitle-text"]'),
  )
  const activeSource = await page.getAttribute('[data-testid="preview"]', 'data-active-source')
  check(
    'AC-026 원본 파일도 함께 복원돼 미리보기가 산다',
    (await page.locator('[data-testid="preview"] video').count()) > 0 &&
      activeSource === `수업영상.${clip.extension}`,
    `${await page.locator('[data-testid="preview"] video').count()}개 / 활성 원본 ${activeSource}`,
  )
  check(
    'AC-026 원본을 못 찾았다는 경고가 없다',
    (await page.locator('[data-testid="storage-warning"]').count()) === 0,
  )

  const afterRestore = await storedCounts()
  check(
    '원본 사본은 넣은 파일 수만큼만 저장된다',
    afterRestore.media === 2,
    `${afterRestore.media}개`,
  )

  // ---------- AC-035 이름 바꾸기와 삭제 ----------
  // 두 번째 프로젝트를 만든다. 새로고침하면 빈 상태에서 시작한다.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await addFiles([`두번째.${clip.extension}`])
  await waitForSave('두번째', 1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="project-list"]', { timeout: 15_000 })
  check(
    'AC-035 준비: 프로젝트 2개',
    (await page.locator('[data-testid="project-item"]').count()) === 2,
    `${await page.locator('[data-testid="project-item"]').count()}개`,
  )

  // 맨 위(가장 최근)의 이름을 바꾸고, 아래 것을 지운다.
  await page.locator('[data-testid="project-rename"]').first().click()
  await page.fill('[data-testid="project-rename-input"]', '국어 3단원')
  await page.press('[data-testid="project-rename-input"]', 'Enter')
  await page
    .waitForFunction(
      () =>
        document.querySelector('[data-testid="project-item"]')?.dataset.projectName ===
        '국어 3단원',
      { timeout: 10_000 },
    )
    .catch(() => {})
  const renamed = await page.getAttribute('[data-testid="project-item"]', 'data-project-name')
  check('AC-035 이름이 바뀐다', renamed === '국어 3단원', renamed)

  const doomed = await page
    .locator('[data-testid="project-item"]')
    .nth(1)
    .getAttribute('data-project-name')
  await page.locator('[data-testid="project-delete"]').nth(1).click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="project-item"]').length === 1,
    { timeout: 10_000 },
  )

  const afterDelete = await storedCounts()
  check(
    'AC-035 지운 프로젝트가 저장소에서 사라진다',
    afterDelete.projects === 1 && !afterDelete.names.includes(doomed),
    `남은 프로젝트 ${afterDelete.names.join(', ')}`,
  )
  check(
    'AC-035 지운 프로젝트의 원본 사본도 사라진다',
    afterDelete.media === 1,
    `원본 사본 ${afterDelete.media}개`,
  )

  // ---------- AC-030 저장공간 부족 ----------
  // 실제로 디스크를 채울 수는 없으므로 브라우저가 알려 주는 남은 용량만
  // 바꿔 끼운다. 제품 코드에는 시험용 분기를 두지 않는다.
  await page.addInitScript(() => {
    navigator.storage.estimate = async () => ({ usage: 1_000_000, quota: 1_000_100 })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await addFiles([`큰영상.${clip.extension}`])

  const warned = await page
    .waitForSelector('[data-testid="storage-warning"]', { timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  check('AC-030 저장공간이 부족하면 경고가 뜬다', warned)
  if (warned) {
    const message = await page.locator('[data-testid="storage-warning"]').innerText()
    check(
      'AC-030 경고가 무엇을 해야 하는지 알려 준다',
      message.includes('내보내기'),
      message.split('\n')[0],
    )
  }

  // AC-030: 앱이 멈추지 않는다. 경고 뒤에도 편집이 그대로 된다.
  await page.locator('[data-testid="clip"]').first().click()
  await page.click('[data-testid="split"]')
  check(
    'AC-030 경고 뒤에도 편집이 된다',
    (await page.locator('[data-testid="clip"]').count()) === 2,
    `${await page.locator('[data-testid="clip"]').count()}개`,
  )

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

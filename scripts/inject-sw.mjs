/**
 * 빌드 결과를 서비스 워커의 캐시 목록에 채워 넣는다 (FR-032).
 *
 * Vite 는 파일 이름에 해시를 붙이므로 목록을 손으로 적어 둘 수 없다.
 * 빌드가 끝난 뒤 dist 를 훑어 그대로 적는다.
 *
 *   node scripts/inject-sw.mjs
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist')

/** 서비스 워커 자신은 캐시하지 않는다. 그러면 새 버전을 영영 못 받는다. */
const SKIP = new Set(['sw.js'])

async function collect(dir) {
  const found = []
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry)
    if ((await stat(full)).isDirectory()) {
      found.push(...(await collect(full)))
      continue
    }
    const path = `/${relative(dist, full).split('\\').join('/')}`
    if (!SKIP.has(path.slice(1))) found.push(path)
  }
  return found
}

const files = (await collect(dist)).sort()
const source = await readFile(join(dist, 'sw.js'), 'utf8')
const buildId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)

await writeFile(
  join(dist, 'sw.js'),
  source
    .replace('__BUILD_ID__', buildId)
    .replace('__PRECACHE__', JSON.stringify(files, null, 2)),
)

console.log(`서비스 워커에 ${files.length}개 파일을 캐시 목록으로 넣었습니다 (${buildId})`)

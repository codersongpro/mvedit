/**
 * 글꼴을 npm 패키지에서 public/fonts 로 옮기고 자막 글꼴 목록을 만든다 (FR-050).
 *
 * 글꼴은 저장소에 넣지 않는다. 한글 글꼴은 조각 파일이 수백 개라 바이너리가
 * 저장소를 무겁게 만들고, 버전을 올릴 때마다 손으로 갈아 끼워야 한다.
 * 패키지를 고정해 두고 빌드할 때마다 같은 결과를 만든다.
 *
 * 한글은 글자 범위별 조각(unicode-range)으로 나뉘어 있다. 브라우저는 화면에
 * 나온 글자가 든 조각만 받으므로, 글꼴 11개를 담아도 실제로 받는 양은 작다.
 *
 *   node scripts/fonts.mjs
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const publicFonts = join(root, 'public', 'fonts')
const captionDir = join(publicFonts, 'caption')

const registry = JSON.parse(await readFile(join(root, 'src/lib/media/captionFonts.json'), 'utf8'))

// 앱 화면 글꼴. 굵기 축이 하나로 들어 있는 가변 글꼴이라 파일 하나면 된다.
const pretendard = require.resolve('pretendard/dist/web/variable/woff2/PretendardVariable.woff2')
await mkdir(publicFonts, { recursive: true })
await copyFile(pretendard, join(publicFonts, 'PretendardVariable.woff2'))

await rm(captionDir, { recursive: true, force: true })
await mkdir(captionDir, { recursive: true })

const faces = []
for (const font of registry) {
  if (font.id === 'pretendard') {
    faces.push({
      id: font.id,
      family: font.family,
      weight: '45 920',
      url: '/fonts/PretendardVariable.woff2',
      unicodeRange: null,
    })
    continue
  }
  const packageDir = dirname(require.resolve(`${font.package}/package.json`))
  await mkdir(join(captionDir, font.id), { recursive: true })
  for (const weight of font.weights) {
    const css = await readFile(join(packageDir, `${weight}.css`), 'utf8')
    for (const block of css.split('@font-face').slice(1)) {
      const file = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1]
      const range = block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim() ?? null
      if (!file) continue
      await copyFile(join(packageDir, 'files', file), join(captionDir, font.id, file))
      faces.push({
        id: font.id,
        family: font.family,
        weight: String(weight),
        url: `/fonts/caption/${font.id}/${file}`,
        unicodeRange: range,
      })
    }
  }
}

// 글꼴마다 따로 둔다. 한 파일에 다 담으면 조각 목록만 수백 KB 라, 고르지도 않은
// 글꼴의 목록까지 매번 받게 된다.
for (const font of registry) {
  const own = faces.filter((face) => face.id === font.id)
  await writeFile(join(captionDir, `${font.id}.json`), JSON.stringify(own))
}
console.log(`자막 글꼴 ${registry.length}종, 조각 ${faces.length}개를 준비했습니다`)

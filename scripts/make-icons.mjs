/**
 * 앱 아이콘 생성 (FR-032).
 *
 * 그림 파일을 저장소에 넣어 두는 대신 만들어 쓴다. 픽셀을 직접 찍으므로
 * 외부 도구나 의존성이 필요 없고, 색을 바꾸고 싶으면 이 파일만 고치면 된다.
 *
 *   node scripts/make-icons.mjs
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = fileURLToPath(new URL('.', import.meta.url))
const publicDir = join(here, '..', 'public')

const BACKGROUND = [15, 23, 42] // slate-900
const FILM = [226, 232, 240] // slate-200
const ACCENT = [56, 189, 248] // sky-400

/** 필름 한 컷과 그 위를 지나는 재생헤드. 편집 도구라는 것이 한눈에 보인다. */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    pixels[i] = r
    pixels[i + 1] = g
    pixels[i + 2] = b
    pixels[i + 3] = a
  }

  // 배경은 꽉 채운다. maskable 아이콘은 가장자리가 잘려 나갈 수 있다.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) put(x, y, BACKGROUND)
  }

  const unit = size / 16
  const frameTop = Math.round(unit * 4)
  const frameBottom = Math.round(unit * 12)
  const frameLeft = Math.round(unit * 2)
  const frameRight = Math.round(unit * 14)

  // 필름 몸통
  for (let y = frameTop; y < frameBottom; y += 1) {
    for (let x = frameLeft; x < frameRight; x += 1) put(x, y, FILM)
  }

  // 위아래 구멍 줄. 필름처럼 보이게 하는 것은 이 구멍이다.
  const holeSize = Math.round(unit * 0.9)
  const holeGap = Math.round(unit * 2)
  for (let x = frameLeft + holeGap / 2; x + holeSize < frameRight; x += holeGap) {
    for (let dy = 0; dy < holeSize; dy += 1) {
      for (let dx = 0; dx < holeSize; dx += 1) {
        put(Math.round(x + dx), frameTop + Math.round(unit * 0.6) + dy, BACKGROUND)
        put(Math.round(x + dx), frameBottom - Math.round(unit * 1.5) + dy, BACKGROUND)
      }
    }
  }

  // 재생헤드. 중앙 고정 재생헤드가 이 앱의 특징이다.
  const headX = Math.round(size / 2)
  const headWidth = Math.max(2, Math.round(unit * 0.5))
  for (let y = Math.round(unit * 2.5); y < Math.round(unit * 13.5); y += 1) {
    for (let dx = 0; dx < headWidth; dx += 1) put(headX + dx, y, ACCENT)
  }

  return pixels
}

function toPng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([length, body, crc])
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // 비트 깊이
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) {
  await writeFile(join(publicDir, `icon-${size}.png`), toPng(size, drawIcon(size)))
  console.log(`public/icon-${size}.png`)
}

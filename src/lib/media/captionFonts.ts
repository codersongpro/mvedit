import registry from './captionFonts.json'

/**
 * 자막 글꼴 (FR-050).
 *
 * 미리보기(DOM)와 내보내기 워커가 같은 글꼴 파일을 같은 이름으로 등록한다.
 * 한쪽만 기기 기본 글꼴로 떨어지면 미리보기에서 본 자막과 결과물이 달라진다.
 * 파일과 조각 목록은 빌드 때 scripts/fonts.mjs 가 public/fonts 에 만든다.
 */

export interface CaptionFont {
  id: string
  label: string
  family: string
  weights: number[]
  hint: string
  /** 글꼴 자체가 작게 그려지는 경우의 크기 보정(손글씨 등) */
  scale?: number
}

export const CAPTION_FONTS: CaptionFont[] = registry
export const DEFAULT_CAPTION_FONT = 'pretendard'

export function captionFont(id: string | undefined): CaptionFont {
  return CAPTION_FONTS.find((font) => font.id === id) ?? CAPTION_FONTS[0]
}

/** 글꼴이 아직 없을 때를 대비한 뒤 순서. 한글이 깨지지 않게 한글 고딕을 둔다. */
export function fontStack(id: string | undefined): string {
  return `"${captionFont(id).family}", "Pretendard Variable", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
}

/**
 * 글꼴이 실제로 가진 가장 가까운 굵기.
 *
 * 한 가지 굵기뿐인 제목용 글꼴에 800 을 요구하면 브라우저가 획을 억지로
 * 두껍게 칠해(가짜 굵게) 모양이 뭉개지고, 캔버스와 DOM 의 결과도 달라진다.
 */
export function nearestWeight(id: string | undefined, wanted: number): number {
  const weights = captionFont(id).weights
  return weights.reduce((best, weight) =>
    Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best,
  )
}

interface FaceEntry {
  family: string
  weight: string
  url: string
  unicodeRange: string | null
}

/** 앱 화면 글꼴이기도 해서 첫 방문 캐시에 들어 있다. 목록 파일 없이 바로 쓴다. */
const PRETENDARD_FACE: FaceEntry = {
  family: 'Pretendard Variable',
  weight: '45 920',
  url: '/fonts/PretendardVariable.woff2',
  unicodeRange: null,
}

const registered = new WeakMap<FontFaceSet, Map<string, Promise<void>>>()

/**
 * 글꼴 하나의 조각들을 등록한다. 같은 곳에 두 번 등록하지 않는다.
 *
 * 조각은 등록만 하고 받지는 않는다. 화면에 그 범위의 글자가 나올 때 브라우저가
 * 받는다. `skipPretendard` 는 CSS 가 이미 같은 글꼴을 선언한 문서에서 쓴다.
 */
export function registerCaptionFont(
  fonts: FontFaceSet,
  id: string,
  { origin, skipPretendard = false }: { origin: string; skipPretendard?: boolean },
): Promise<void> {
  let perSet = registered.get(fonts)
  if (!perSet) {
    perSet = new Map()
    registered.set(fonts, perSet)
  }
  const existing = perSet.get(id)
  if (existing) return existing

  const task = (async () => {
    if (id === DEFAULT_CAPTION_FONT) {
      if (!skipPretendard) addFace(fonts, PRETENDARD_FACE, origin)
      return
    }
    const response = await fetch(new URL(`/fonts/caption/${id}.json`, origin))
    if (!response.ok) throw new Error(`글꼴 목록을 받지 못했습니다: ${id}`)
    const faces = (await response.json()) as FaceEntry[]
    for (const face of faces) addFace(fonts, face, origin)
  })()
  // 실패한 등록은 남기지 않는다. 오프라인이었다가 다시 연결되면 다시 시도할 수 있게.
  task.catch(() => perSet.delete(id))
  perSet.set(id, task)
  return task
}

function addFace(fonts: FontFaceSet, face: FaceEntry, origin: string): void {
  const descriptors: FontFaceDescriptors = { weight: face.weight, style: 'normal' }
  if (face.unicodeRange) descriptors.unicodeRange = face.unicodeRange
  fonts.add(new FontFace(face.family, `url(${new URL(face.url, origin).href})`, descriptors))
}

/**
 * 캔버스에 그리기 전에 필요한 글꼴 조각을 다 받아 둔다.
 *
 * 캔버스는 글꼴이 아직 없으면 기다리지 않고 기본 글꼴로 그려 버린다. 내보내기
 * 첫 프레임부터 같은 글꼴이 나오려면 미리 받아야 한다.
 */
export async function loadCaptionFonts(
  fonts: FontFaceSet,
  uses: { id: string; weight: number; text: string }[],
  origin: string,
): Promise<void> {
  const ids = [...new Set(uses.map((use) => use.id))]
  await Promise.all(ids.map((id) => registerCaptionFont(fonts, id, { origin }).catch(() => {})))
  await Promise.all(
    uses.map((use) =>
      fonts
        .load(`${use.weight} 32px "${captionFont(use.id).family}"`, use.text || '가')
        .catch(() => []),
    ),
  )
}

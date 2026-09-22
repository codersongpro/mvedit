/**
 * 프로젝트 파일 `.cutcap` (FR-024, FR-025).
 *
 * 영상 데이터는 넣지 않는다. 편집 내용만 담기 때문에 수 KB 로 끝나고,
 * 메신저로 보내거나 클라우드에 두기 쉽다 (AC-027). 대신 열 때 원본 파일을
 * 다시 골라야 하므로, 무엇이 필요한지 파일 이름과 크기로 알려 준다 (AC-029).
 */
import type { ExportSetting, MediaSource, Subtitle, SubtitleStyle, TimelineItem } from './types'

export const PROJECT_FILE_EXTENSION = 'cutcap'
const FORMAT = 'cutcap-project'
const VERSION = 1

/** 원본을 다시 찾기 위한 정보. 썸네일은 다시 만들 수 있어 넣지 않는다. */
export type ProjectFileSource = Omit<MediaSource, 'file' | 'thumbnailUrl'>

export interface ProjectFile {
  format: typeof FORMAT
  version: number
  name: string
  savedAt: number
  sources: ProjectFileSource[]
  timeline: TimelineItem[]
  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  exportSetting: ExportSetting
}

export interface ProjectFileInput {
  name: string
  sources: MediaSource[]
  timeline: TimelineItem[]
  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  exportSetting: ExportSetting
}

export function buildProjectFile(input: ProjectFileInput): ProjectFile {
  return {
    format: FORMAT,
    version: VERSION,
    name: input.name,
    savedAt: Date.now(),
    sources: input.sources.map(({ file: _file, thumbnailUrl: _thumbnail, ...rest }) => rest),
    timeline: input.timeline,
    subtitles: input.subtitles,
    subtitleStyle: input.subtitleStyle,
    exportSetting: input.exportSetting,
  }
}

/** 사람이 열어 봐도 읽히게 둔다. 들여쓰기를 넣어도 수십 KB 를 넘지 않는다. */
export function serializeProjectFile(project: ProjectFile): string {
  return JSON.stringify(project, null, 2)
}

export function projectFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim() || '프로젝트'
  return `${safe}.${PROJECT_FILE_EXTENSION}`
}

export class ProjectFileError extends Error {}

/**
 * 파일을 읽어 검사한다.
 *
 * 남의 파일이나 손상된 파일을 그대로 밀어 넣으면 화면이 빈 채로 깨진다.
 * 무엇이 잘못됐는지 사용자 말로 알려 주고 멈춘다.
 */
export function parseProjectFile(text: string): ProjectFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ProjectFileError('프로젝트 파일이 아니거나 내용이 깨졌습니다.')
  }

  if (typeof data !== 'object' || data === null) {
    throw new ProjectFileError('프로젝트 파일이 아닙니다.')
  }
  const candidate = data as Partial<ProjectFile>

  if (candidate.format !== FORMAT) {
    throw new ProjectFileError('CutCap 프로젝트 파일이 아닙니다.')
  }
  if (typeof candidate.version !== 'number' || candidate.version > VERSION) {
    throw new ProjectFileError(
      '더 새로운 버전에서 만든 파일입니다. 이 페이지를 새로고침한 뒤 다시 열어 주세요.',
    )
  }
  if (
    !Array.isArray(candidate.sources) ||
    !Array.isArray(candidate.timeline) ||
    !Array.isArray(candidate.subtitles) ||
    typeof candidate.subtitleStyle !== 'object' ||
    typeof candidate.exportSetting !== 'object'
  ) {
    throw new ProjectFileError('프로젝트 파일의 내용이 올바르지 않습니다.')
  }

  return {
    ...(candidate as ProjectFile),
    name: typeof candidate.name === 'string' && candidate.name ? candidate.name : '불러온 프로젝트',
    savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : Date.now(),
  }
}

/**
 * 고른 파일이 이 원본인지 본다.
 *
 * 이름이 같으면 받아들이고, 이름이 달라도 크기가 똑같으면 같은 파일로 본다.
 * 다운로드 폴더에서 "영상 (1).mp4" 처럼 이름만 바뀌는 일이 흔하다.
 */
export function looksLikeSource(source: ProjectFileSource, file: File): boolean {
  return file.name === source.fileName || file.size === source.fileSize
}

/** 고른 파일들을 필요한 원본에 짝지어 준다. 짝을 찾은 것만 돌려준다. */
export function matchFiles(
  sources: ProjectFileSource[],
  files: File[],
): { matched: Map<string, File>; unused: File[] } {
  const matched = new Map<string, File>()
  const remaining = [...files]

  // 이름이 정확히 같은 것부터 짝짓는다. 크기만 같은 다른 파일에 먼저
  // 붙어 버리면 엉뚱한 영상이 들어간다.
  for (const pass of ['name', 'size'] as const) {
    for (const source of sources) {
      if (matched.has(source.id)) continue
      const index = remaining.findIndex((file) =>
        pass === 'name' ? file.name === source.fileName : file.size === source.fileSize,
      )
      if (index === -1) continue
      matched.set(source.id, remaining[index])
      remaining.splice(index, 1)
    }
  }

  // 필요한 원본이 하나뿐이고 파일도 하나만 골랐다면 이름이 달라도 그것이다.
  if (matched.size === 0 && sources.length === 1 && remaining.length === 1) {
    matched.set(sources[0].id, remaining[0])
    remaining.length = 0
  }

  return { matched, unused: remaining }
}

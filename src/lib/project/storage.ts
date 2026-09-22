/**
 * 브라우저 저장소 (FR-023, FR-026, FR-031).
 *
 * IndexedDB 하나만 쓴다. OPFS 도 후보였지만 원본 파일과 편집 내용을 서로 다른
 * 저장소에 두면 둘이 어긋났을 때 복구가 어렵고, 지원 범위도 IndexedDB 쪽이
 * 넓다. IndexedDB 는 File 을 그대로 담을 수 있어 변환 비용도 없다.
 *
 * 저장소를 둘로 나눈 이유는 크기 차이다. 편집 내용은 수십 KB 라 조작할 때마다
 * 다시 써도 되지만, 원본은 수백 MB 라 불러올 때 한 번만 쓴다.
 */
import type { ExportSetting, MediaSource, Subtitle, SubtitleStyle, TimelineItem } from './types'

const DB_NAME = 'cutcap'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const MEDIA_STORE = 'media'

/** 저장되는 원본 정보. File 은 media 저장소에 따로 둔다. */
export type StoredSource = Omit<MediaSource, 'file'>

export interface StoredProject {
  id: string
  name: string
  /** 마지막으로 저장된 시각 (epoch ms) */
  updatedAt: number
  sources: StoredSource[]
  timeline: TimelineItem[]
  subtitles: Subtitle[]
  subtitleStyle: SubtitleStyle
  exportSetting: ExportSetting
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
  clipCount: number
  thumbnailUrl: string | null
}

export interface RestoredProject {
  project: StoredProject
  /** 원본 id → 파일. 찾지 못한 원본은 빠져 있다. */
  files: Map<string, File>
  /** 원본을 찾지 못한 파일 이름들 (FR-025 의 재연결 대상) */
  missing: string[]
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const media = db.createObjectStore(MEDIA_STORE, { keyPath: 'key' })
        media.createIndex('projectId', 'projectId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 트랜잭션 하나를 열고 끝까지 기다린다. 닫히기 전에 반환하면 쓰기가 유실된다. */
async function withStore<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction(storeNames, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const result = await run(tx)
    await done
    return result
  } finally {
    db.close()
  }
}

const mediaKey = (projectId: string, sourceId: string) => `${projectId}:${sourceId}`

export async function saveProject(project: StoredProject): Promise<void> {
  await withStore(PROJECT_STORE, 'readwrite', (tx) => {
    tx.objectStore(PROJECT_STORE).put(project)
  })
}

export async function saveMedia(projectId: string, sourceId: string, file: File): Promise<void> {
  await withStore(MEDIA_STORE, 'readwrite', (tx) => {
    tx.objectStore(MEDIA_STORE).put({ key: mediaKey(projectId, sourceId), projectId, file })
  })
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await withStore(PROJECT_STORE, 'readonly', (tx) =>
    request(tx.objectStore(PROJECT_STORE).getAll() as IDBRequest<StoredProject[]>),
  )
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      clipCount: project.timeline.length,
      thumbnailUrl: project.sources.find((source) => source.thumbnailUrl)?.thumbnailUrl ?? null,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadProject(id: string): Promise<RestoredProject | null> {
  const db = await openDb()
  try {
    const tx = db.transaction([PROJECT_STORE, MEDIA_STORE], 'readonly')
    const project = await request(
      tx.objectStore(PROJECT_STORE).get(id) as IDBRequest<StoredProject | undefined>,
    )
    if (!project) return null

    const files = new Map<string, File>()
    const missing: string[] = []
    for (const source of project.sources) {
      const record = await request(
        tx.objectStore(MEDIA_STORE).get(mediaKey(id, source.id)) as IDBRequest<
          { file: File } | undefined
        >,
      )
      if (record?.file) files.set(source.id, record.file)
      else missing.push(source.fileName)
    }
    return { project, files, missing }
  } finally {
    db.close()
  }
}

/** 프로젝트와 그 원본 사본을 함께 지운다 (AC-035). */
export async function deleteProject(id: string): Promise<void> {
  await withStore([PROJECT_STORE, MEDIA_STORE], 'readwrite', async (tx) => {
    tx.objectStore(PROJECT_STORE).delete(id)
    const index = tx.objectStore(MEDIA_STORE).index('projectId')
    const keys = await request(index.getAllKeys(id) as IDBRequest<IDBValidKey[]>)
    for (const key of keys) tx.objectStore(MEDIA_STORE).delete(key)
  })
}

export async function renameProject(id: string, name: string): Promise<void> {
  await withStore(PROJECT_STORE, 'readwrite', async (tx) => {
    const store = tx.objectStore(PROJECT_STORE)
    const project = await request(store.get(id) as IDBRequest<StoredProject | undefined>)
    if (!project) return
    store.put({ ...project, name, updatedAt: Date.now() })
  })
}

export interface StorageRoom {
  usage: number
  quota: number
  available: number
}

export async function estimateStorage(): Promise<StorageRoom | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota, available: Math.max(0, quota - usage) }
  } catch {
    return null
  }
}

/**
 * 원본을 복사해 둘 공간이 있는지 본다 (FR-026).
 *
 * 파일 크기보다 20% 넉넉히 잡는다. 편집 내용과 인덱스도 자리를 차지하고,
 * 꽉 채우면 브라우저가 다른 데이터를 지우기 시작한다.
 */
export const STORAGE_HEADROOM = 1.2

export function hasRoomFor(bytes: number, room: StorageRoom | null): boolean {
  if (!room || room.quota === 0) return true
  return room.available > bytes * STORAGE_HEADROOM
}

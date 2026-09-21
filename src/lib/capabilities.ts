/**
 * 브라우저 환경 진단.
 *
 * 진단 화면 표시용이자, 이후 페이즈에서 실제 기능 분기에 쓰는 모듈이다.
 * - WebCodecs 미지원 시 ffmpeg.wasm 경로로 전환 (FR-028)
 * - 저장소 잔여 용량 경고 (FR-026)
 * - iOS Safari 7일 저장소 삭제 고지 (FR-027)
 */

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface CapabilityCheck {
  /** 화면에 보여줄 항목 이름 */
  label: string
  status: CheckStatus
  /** 무엇이 되고 무엇이 안 되는지 한국어 설명 */
  detail: string
}

export interface Capabilities {
  /** COOP/COEP가 적용돼 SharedArrayBuffer를 쓸 수 있는가 */
  crossOriginIsolated: boolean
  sharedArrayBuffer: boolean
  /** WebCodecs 인코더·디코더 존재 여부 */
  webCodecs: boolean
  /** H.264 인코딩 설정이 실제로 지원되는가 */
  h264Encode: boolean
  opfs: boolean
  indexedDB: boolean
  /** 저장소 잔여 바이트. 조회 불가 시 null */
  storageQuota: number | null
  storageUsage: number | null
  isIOS: boolean
  checks: CapabilityCheck[]
}

/** 내보내기 기본값과 같은 H.264 Baseline 1080p 설정으로 지원 여부를 확인한다. */
const H264_PROBE_CONFIG = {
  codec: 'avc1.42001f',
  width: 1920,
  height: 1080,
  bitrate: 4_000_000,
  framerate: 30,
} as const

function hasWebCodecs(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window
}

async function probeH264Encode(): Promise<boolean> {
  if (!hasWebCodecs()) return false
  try {
    const support = await VideoEncoder.isConfigSupported(H264_PROBE_CONFIG)
    return support.supported === true
  } catch {
    return false
  }
}

function hasOPFS(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

/**
 * iOS 판별. iPadOS 13+ 는 userAgent 에 Macintosh 로 나오므로
 * 터치 지원 여부를 함께 본다.
 */
export function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPod|iPad/.test(ua)) return true
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1
}

async function readStorageEstimate(): Promise<{ quota: number | null; usage: number | null }> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
    return { quota: null, usage: null }
  }
  try {
    const estimate = await navigator.storage.estimate()
    return { quota: estimate.quota ?? null, usage: estimate.usage ?? null }
  } catch {
    return { quota: null, usage: null }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

export async function detectCapabilities(): Promise<Capabilities> {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  const sab = typeof SharedArrayBuffer !== 'undefined'
  const webCodecs = hasWebCodecs()
  const h264Encode = await probeH264Encode()
  const opfs = hasOPFS()
  const idb = hasIndexedDB()
  const isIOS = detectIOS()
  const { quota, usage } = await readStorageEstimate()

  const checks: CapabilityCheck[] = [
    {
      label: '교차 출처 격리 (COOP/COEP)',
      status: isolated ? 'ok' : 'fail',
      detail: isolated
        ? '적용됨. 고속 인코딩에 필요한 공유 메모리를 사용할 수 있습니다.'
        : '적용되지 않았습니다. 이 상태로는 ffmpeg 폴백 인코딩이 매우 느려집니다.',
    },
    {
      label: 'SharedArrayBuffer',
      status: sab ? 'ok' : 'fail',
      detail: sab
        ? '사용 가능. 인코딩을 여러 스레드로 나눠 처리할 수 있습니다.'
        : '사용 불가. 인코딩이 단일 스레드로만 동작합니다.',
    },
    {
      label: 'WebCodecs',
      status: webCodecs ? 'ok' : 'warn',
      detail: webCodecs
        ? '지원됨. 기기 하드웨어 가속으로 빠르게 내보낼 수 있습니다.'
        : '미지원. 내보내기는 동작하지만 ffmpeg 방식이라 시간이 훨씬 오래 걸립니다.',
    },
    {
      label: 'H.264 인코딩 (1080p)',
      status: h264Encode ? 'ok' : 'warn',
      detail: h264Encode
        ? '지원됨. MP4를 바로 만들 수 있습니다.'
        : webCodecs
          ? '이 기기에서는 1080p H.264 인코딩 설정이 거부되었습니다. 해상도를 낮추거나 ffmpeg 방식을 씁니다.'
          : 'WebCodecs가 없어 확인할 수 없습니다.',
    },
    {
      label: '파일 저장소 (OPFS)',
      status: opfs ? 'ok' : 'warn',
      detail: opfs
        ? '사용 가능. 원본 영상을 기기에 보관해 작업을 이어갈 수 있습니다.'
        : '사용 불가. 자동 저장 대신 프로젝트 파일 내보내기를 써야 합니다.',
    },
    {
      label: '프로젝트 저장소 (IndexedDB)',
      status: idb ? 'ok' : 'fail',
      detail: idb ? '사용 가능.' : '사용 불가. 방문자 모드인지 확인해 주세요.',
    },
    {
      label: '저장 공간',
      status: quota === null ? 'warn' : 'ok',
      detail:
        quota === null
          ? '이 브라우저는 남은 용량을 알려주지 않습니다. 큰 영상은 저장에 실패할 수 있습니다.'
          : `사용 중 ${formatBytes(usage ?? 0)} / 사용 가능 ${formatBytes(quota)}`,
    },
  ]

  if (isIOS) {
    checks.push({
      label: 'iOS 저장 정책',
      status: 'warn',
      detail:
        '아이폰·아이패드 사파리는 7일 동안 방문하지 않으면 저장된 작업을 지웁니다. 홈 화면에 추가하면 이 규칙을 피할 수 있습니다.',
    })
  }

  return {
    crossOriginIsolated: isolated,
    sharedArrayBuffer: sab,
    webCodecs,
    h264Encode,
    opfs,
    indexedDB: idb,
    storageQuota: quota,
    storageUsage: usage,
    isIOS,
    checks,
  }
}

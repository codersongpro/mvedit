/**
 * 자동 자막에 쓸 Whisper 모델 고르기 (FR-039).
 *
 * 한국어는 작은 모델일수록 오인식이 눈에 띄게 늘고, 큰 모델은 내려받는 양과
 * 메모리가 급격히 커진다. 그래서 기기가 감당할 수 있는 가장 큰 모델을
 * 자동으로 고르되, 사용자가 직접 바꿀 수 있게 둔다.
 */

export type ModelChoice = 'auto' | 'fast' | 'balanced' | 'accurate'
export type ModelTier = Exclude<ModelChoice, 'auto'>
export type CaptionLanguage = 'korean' | 'english' | 'auto'

export interface ModelSpec {
  tier: ModelTier
  id: string
  label: string
  /** 처음 한 번 내려받는 대략의 크기. 안내 문구용이다. */
  approxMb: number
  /** WebGPU 없이 CPU(WASM)로 돌리면 너무 느리거나 메모리가 모자란다. */
  needsWebGpu: boolean
}

export const MODELS: Record<ModelTier, ModelSpec> = {
  fast: {
    tier: 'fast',
    id: 'onnx-community/whisper-base',
    label: '빠름',
    approxMb: 80,
    needsWebGpu: false,
  },
  balanced: {
    tier: 'balanced',
    id: 'onnx-community/whisper-small',
    label: '보통',
    approxMb: 250,
    needsWebGpu: false,
  },
  accurate: {
    tier: 'accurate',
    id: 'onnx-community/whisper-large-v3-turbo',
    label: '정확',
    approxMb: 1000,
    needsWebGpu: true,
  },
}

export interface DeviceInfo {
  webgpu: boolean
  /** fp16 셰이더. 큰 모델을 반값 메모리로 올리려면 필요하다. */
  shaderF16: boolean
  /** GB. 알 수 없으면 null (사파리·파이어폭스는 알려 주지 않는다) */
  memoryGb: number | null
}

/** WebGPU 가 있다고 해도 어댑터를 못 받는 기기가 있어 실제로 요청해 본다. */
export async function detectDevice(): Promise<DeviceInfo> {
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> }
    deviceMemory?: number
  }
  let webgpu = false
  let shaderF16 = false
  try {
    const adapter = await nav.gpu?.requestAdapter()
    if (adapter) {
      webgpu = true
      shaderF16 = adapter.features.has('shader-f16')
    }
  } catch {
    /* WebGPU 가 막혀 있으면 CPU 로 간다 */
  }
  return { webgpu, shaderF16, memoryGb: nav.deviceMemory ?? null }
}

/** 큰 모델은 WebGPU·fp16·넉넉한 메모리가 다 있어야 끝까지 돈다. */
export function canRunAccurate(device: DeviceInfo): boolean {
  return device.webgpu && device.shaderF16 && (device.memoryGb === null || device.memoryGb >= 8)
}

export function resolveModel(choice: ModelChoice, device: DeviceInfo): ModelSpec {
  if (choice === 'auto') return canRunAccurate(device) ? MODELS.accurate : MODELS.balanced
  if (choice === 'accurate' && !canRunAccurate(device)) return MODELS.balanced
  return MODELS[choice]
}

/** 워커가 모델을 올릴 때 쓰는 장치·정밀도. 화면과 워커가 같은 규칙을 쓰도록 여기 둔다. */
export function runtimeOf(spec: ModelSpec, device: DeviceInfo) {
  if (!device.webgpu) return { device: 'wasm' as const, dtype: 'q8' as const }
  // 인코더를 양자화하면 한국어 받침·조사 오인식이 늘어 인코더는 높은 정밀도로 둔다.
  return {
    device: 'webgpu' as const,
    dtype: {
      encoder_model: spec.tier === 'accurate' ? ('fp16' as const) : ('fp32' as const),
      decoder_model_merged: 'q4' as const,
    },
  }
}

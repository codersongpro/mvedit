/**
 * 음성 인식 워커 (FR-039).
 *
 * 모델 추론만 맡는다. 소리를 꺼내고 자막 줄로 나누는 일은 화면 쪽이 한다.
 * 이렇게 나눠 두어야 모델 없이도(테스트에서 이 워커만 바꿔 끼워) 나머지
 * 흐름 전체를 실제 화면으로 검증할 수 있다.
 *
 * 모델 파일은 Hugging Face 에서 한 번 내려받아 브라우저 캐시(Cache API)에
 * 두고 다음부터는 꺼내 쓴다. 영상·음성은 이 워커 밖으로 나가지 않는다.
 */
import { env, pipeline } from '@huggingface/transformers'

export type WorkerRequest =
  | {
      type: 'load'
      modelId: string
      device: 'webgpu' | 'wasm'
      dtype: string | Record<string, string>
    }
  | { type: 'transcribe'; id: number; pcm: Float32Array; language: string | null }

export type WorkerResponse =
  | { type: 'load-progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; chunks: { text: string; timestamp: [number, number | null] }[] }
  | { type: 'error'; id?: number; message: string }

// 로컬 /models 경로를 먼저 찾으면 SPA 재작성 규칙 때문에 index.html 을 모델로 착각한다.
env.allowLocalModels = false

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>

let transcriber: Transcriber | null = null

const post = (message: WorkerResponse) => self.postMessage(message)

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'load') {
    try {
      const created = await pipeline('automatic-speech-recognition', message.modelId, {
        device: message.device,
        dtype: message.dtype as never,
        progress_callback: (info: { status: string; loaded?: number; total?: number }) => {
          if (info.status === 'progress_total' && info.total) {
            post({ type: 'load-progress', loaded: info.loaded ?? 0, total: info.total })
          }
        },
      })
      transcriber = created as unknown as Transcriber
      post({ type: 'ready' })
    } catch (error) {
      post({ type: 'error', message: String((error as Error)?.message ?? error) })
    }
    return
  }

  if (message.type === 'transcribe') {
    if (!transcriber) {
      post({ type: 'error', id: message.id, message: 'model-not-loaded' })
      return
    }
    try {
      const output = await transcriber(message.pcm, {
        return_timestamps: true,
        task: 'transcribe',
        ...(message.language && { language: message.language }),
      })
      post({ type: 'result', id: message.id, chunks: output.chunks ?? [] })
    } catch (error) {
      post({ type: 'error', id: message.id, message: String((error as Error)?.message ?? error) })
    }
  }
}

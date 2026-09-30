/**
 * 미리보기 소리 크기 조절.
 *
 * `HTMLMediaElement.volume` 은 iOS 사파리에서 쓰기가 무시되고(항상 1), 100% 를
 * 넘기지도 못한다. 그러면 페이드가 미리보기에서 들리지 않는다. 웹 오디오의
 * GainNode 는 두 문제가 모두 없어서 요소의 소리를 노드로 돌려 크기를 맞춘다.
 *
 * 컨텍스트가 멈춰(suspended) 있을 때 요소를 노드에 물리면 소리가 통째로 사라지고
 * 되돌릴 수도 없다. 그래서 컨텍스트가 실제로 돌고 있을 때만 물리고, 그 전에는
 * 예전처럼 `volume` 으로 맞춘다.
 */
let context: AudioContext | null = null
const gains = new WeakMap<HTMLMediaElement, GainNode>()

/** 사용자 조작 안에서 불러야 한다. 브라우저가 그때만 오디오 시작을 허락한다. */
export function unlockPreviewAudio(): void {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
  } catch {
    // 웹 오디오가 없는 환경. volume 으로 맞추는 길이 남아 있다.
  }
}

export function setPreviewVolume(element: HTMLMediaElement, volume: number): void {
  const value = Math.max(0, volume)

  let gain = gains.get(element)
  if (!gain && context?.state === 'running') {
    try {
      gain = context.createGain()
      context.createMediaElementSource(element).connect(gain).connect(context.destination)
      gains.set(element, gain)
    } catch {
      gain = undefined
    }
  }

  if (gain) {
    // 노드를 물린 뒤에는 요소 볼륨과 곱해진다. 요소 쪽은 1 로 고정해 이중으로 줄지 않게 한다.
    element.volume = 1
    gain.gain.value = value
  } else {
    element.volume = Math.min(1, value)
  }
}

import { useMemo } from 'react'
import { useProject } from '../lib/project/store'
import {
  MB,
  RESOLUTIONS,
  computeOutputSize,
  estimateFileSize,
  fitResolution,
  floorFileSize,
} from '../lib/media/outputSize'
import { timelineDuration, type AspectRatio, type QualityLevel } from '../lib/project/types'
import { formatBytes } from '../lib/format'

const ASPECTS: Array<{ value: AspectRatio; label: string; hint: string }> = [
  { value: 'source', label: '원본 그대로', hint: '' },
  { value: '16:9', label: '16:9', hint: '유튜브·PC' },
  { value: '9:16', label: '9:16', hint: '릴스·쇼츠' },
  { value: '1:1', label: '1:1', hint: '정사각' },
]

const QUALITIES: Array<{ value: QualityLevel; label: string }> = [
  { value: 'high', label: '높음' },
  { value: 'medium', label: '보통' },
  { value: 'low', label: '낮음' },
]

/**
 * 출력 설정 (FR-014~017).
 *
 * 화면비는 숫자보다 쓰임새로 고르게 한다. "9:16"만 있으면 무엇에 쓰는지
 * 모르지만 "릴스·쇼츠"가 붙으면 바로 고를 수 있다.
 */
export function ExportSettings() {
  const timeline = useProject((state) => state.timeline)
  const sources = useProject((state) => state.sources)
  const setting = useProject((state) => state.exportSetting)
  const setSetting = useProject((state) => state.setExportSetting)

  const duration = timelineDuration(timeline)

  // '원본 그대로'의 기준은 첫 영상이다. 내보내기 쪽과 같은 규칙을 쓴다.
  const sourceSize = useMemo(() => {
    const first = sources.find((source) => source.kind === 'video')
    return first
      ? { width: first.displayWidth, height: first.displayHeight }
      : { width: 1280, height: 720 }
  }, [sources])

  // '원본 그대로'를 골라도 화면비가 다른 클립이 섞여 있으면 맞추는 방법이
  // 결과를 바꾼다. 세로 영상과 가로 영상을 같이 쓰는 경우가 그렇다.
  const mixedAspects = useMemo(() => {
    const ratios = new Set(
      sources
        .filter((source) => source.displayHeight > 0)
        .map((source) => (source.displayWidth / source.displayHeight).toFixed(2)),
    )
    return ratios.size > 1
  }, [sources])
  const fitMatters = setting.aspectRatio !== 'source' || mixedAspects

  const size = computeOutputSize(setting, sourceSize)
  const estimated = estimateFileSize(setting, size, duration)
  // 480p 보다 작은 원본은 목록에 맞는 선택지가 없어 무조건 커진다. 그때
  // 경고를 띄우면 앱이 자기 기본값을 탓하는 셈이라, 낮출 수 있을 때만 알린다.
  const upscaling =
    size.height > sourceSize.height && setting.resolution > fitResolution(sourceSize.height)

  // 목표가 최소 화질로 낼 수 있는 용량보다 작으면 어떻게 해도 못 맞춘다.
  // 내보내기를 돌려 실패를 보여 주기 전에 미리 알린다 (FR-019).
  const floor = floorFileSize(duration)
  const tooSmallTarget = setting.targetSizeMb !== null && setting.targetSizeMb * MB < floor

  return (
    <div
      data-testid="export-settings"
      className="flex flex-col gap-4 rounded-xl bg-slate-900/60 p-4"
    >
      <Row label="화면비">
        {ASPECTS.map((aspect) => (
          <Choice
            key={aspect.value}
            testId={`aspect-${aspect.value}`}
            active={setting.aspectRatio === aspect.value}
            onClick={() => setSetting({ aspectRatio: aspect.value })}
          >
            {aspect.label}
            {aspect.hint && <span className="ml-1 text-[10px] opacity-70">{aspect.hint}</span>}
          </Choice>
        ))}
      </Row>

      {fitMatters && (
        <Row label="맞추는 방법">
          <Choice
            testId="fit-blur"
            active={setting.fitMode === 'blur'}
            onClick={() => setSetting({ fitMode: 'blur' })}
          >
            흐린 배경 채우기
          </Choice>
          <Choice
            testId="fit-contain"
            active={setting.fitMode === 'contain'}
            onClick={() => setSetting({ fitMode: 'contain' })}
          >
            여백 채우기
          </Choice>
          <Choice
            testId="fit-cover"
            active={setting.fitMode === 'cover'}
            onClick={() => setSetting({ fitMode: 'cover' })}
          >
            잘라 채우기
          </Choice>
          <span className="text-[11px] text-slate-500">
            {setting.fitMode === 'blur'
              ? '잘리지 않고, 남는 자리는 같은 화면을 흐리게 키워 채웁니다.'
              : setting.fitMode === 'contain'
                ? '영상이 잘리지 않고 빈 곳에 검은 여백이 생깁니다.'
                : '여백 없이 꽉 차지만 화면 밖이 잘립니다.'}
          </span>
        </Row>
      )}

      <Row label="해상도">
        {RESOLUTIONS.map((resolution) => (
          <Choice
            key={resolution}
            testId={`resolution-${resolution}`}
            active={setting.resolution === resolution}
            onClick={() => setSetting({ resolution })}
          >
            {resolution}p
          </Choice>
        ))}
      </Row>

      <Row label="화질">
        {QUALITIES.map((quality) => (
          <Choice
            key={quality.value}
            testId={`quality-${quality.value}`}
            active={setting.quality === quality.value}
            onClick={() => setSetting({ quality: quality.value })}
          >
            {quality.label}
          </Choice>
        ))}
      </Row>

      <Row label="목표 용량">
        <Choice
          testId="target-off"
          active={setting.targetSizeMb === null}
          onClick={() => setSetting({ targetSizeMb: null })}
        >
          제한 없음
        </Choice>
        <label className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="decimal"
            min={0.1}
            step={0.1}
            data-testid="target-size"
            value={setting.targetSizeMb ?? ''}
            placeholder="예: 20"
            onChange={(event) => {
              const value = Number(event.target.value)
              setSetting({
                targetSizeMb: event.target.value === '' || value <= 0 ? null : value,
              })
            }}
            className="h-10 w-24 rounded-lg bg-slate-800 px-3 text-xs text-slate-100 tabular-nums"
          />
          <span className="text-xs text-slate-400">MB 이하</span>
        </label>
        {setting.targetSizeMb !== null && (
          <span className="text-[11px] text-slate-500">
            용량에 맞춰 화질을 자동으로 낮춥니다. 소리는 그대로 둡니다.
          </span>
        )}
      </Row>

      {tooSmallTarget && (
        <p data-testid="target-too-small" className="text-xs leading-relaxed text-amber-300/80">
          {duration.toFixed(0)}초 영상은 최소 화질로도 약 {formatBytes(floor)} 입니다. 목표를
          늘리거나 영상을 더 짧게 잘라 주세요.
        </p>
      )}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-slate-800 pt-3">
        <span data-testid="output-size" className="text-sm text-slate-200 tabular-nums">
          {size.width}×{size.height}
        </span>
        <span data-testid="estimated-size" className="text-sm text-sky-300 tabular-nums">
          예상 용량 {formatBytes(estimated)}
        </span>
        <span className="text-[11px] text-slate-500">
          {setting.targetSizeMb === null
            ? '대략치입니다. 단순한 장면은 훨씬 작게 나옵니다'
            : '목표를 넘으면 화질을 낮춰 한 번 다시 인코딩합니다'}
        </span>
      </div>

      {upscaling && (
        <p data-testid="upscale-warning" className="text-xs leading-relaxed text-amber-300/80">
          원본({sourceSize.height}p)보다 크게 내보내도 화질은 좋아지지 않고 용량만 커집니다.{' '}
          {fitResolution(sourceSize.height)}p를 권합니다.
        </p>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-slate-400">{label}</span>
      {children}
    </div>
  )
}

function Choice({
  children,
  active,
  onClick,
  testId,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-lg px-3 text-xs font-medium transition-colors ${
        active ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

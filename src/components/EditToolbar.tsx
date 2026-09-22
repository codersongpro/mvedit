import { useProject } from '../lib/project/store'

/**
 * PRD 6절의 키보드 단축키 기준. 영상 기본 프레임율을 30fps로 보고
 * 한 프레임을 이 값으로 잡는다. 실제 프레임율에 맞추는 것은
 * 미리보기 재생 엔진과 함께 다룬다.
 */
export const FRAME_STEP = 1 / 30

export function EditToolbar() {
  const timeline = useProject((state) => state.timeline)
  const selectedItemId = useProject((state) => state.selectedItemId)
  const past = useProject((state) => state.past)
  const future = useProject((state) => state.future)

  const split = useProject((state) => state.split)
  const insertBlank = useProject((state) => state.insertBlank)
  const removeSelected = useProject((state) => state.removeSelected)
  const moveSelected = useProject((state) => state.moveSelected)
  const undo = useProject((state) => state.undo)
  const redo = useProject((state) => state.redo)

  if (timeline.length === 0) return null

  const index = timeline.findIndex((item) => item.id === selectedItemId)
  const hasSelection = index !== -1

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToolButton testId="split" onClick={split} primary>
        자르기
      </ToolButton>
      <ToolButton testId="delete" onClick={removeSelected} disabled={!hasSelection} danger>
        지우기
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-slate-700" />

      <span className="flex items-center gap-1.5">
        <span className="text-xs text-slate-400">빈 화면 추가</span>
        <BlankButton testId="insert-blank" color="#000000" label="검은 빈 화면 추가" onClick={insertBlank} />
        <BlankButton testId="insert-blank-white" color="#FFFFFF" label="흰 빈 화면 추가" onClick={insertBlank} />
      </span>

      <span className="mx-1 h-5 w-px bg-slate-700" />

      <ToolButton
        testId="move-back"
        onClick={() => moveSelected(-1)}
        disabled={!hasSelection || index === 0}
        aria-label="앞으로 옮기기"
      >
        ←
      </ToolButton>
      <ToolButton
        testId="move-forward"
        onClick={() => moveSelected(1)}
        disabled={!hasSelection || index === timeline.length - 1}
        aria-label="뒤로 옮기기"
      >
        →
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-slate-700" />

      <ToolButton testId="undo" onClick={undo} disabled={past.length === 0}>
        되돌리기
      </ToolButton>
      <ToolButton testId="redo" onClick={redo} disabled={future.length === 0}>
        다시 실행
      </ToolButton>
    </div>
  )
}

/**
 * 색을 보고 바로 고르게 한다. 목록을 열어 고르게 하면 탭이 한 번 늘고,
 * 빈 화면은 자막 배경이나 장면 전환으로 자주 넣는 기능이다.
 */
function BlankButton({
  testId,
  color,
  label,
  onClick,
}: {
  testId: string
  color: string
  label: string
  onClick: (duration?: number, color?: string) => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={() => onClick(undefined, color)}
      style={{ backgroundColor: color }}
      className="h-11 w-11 rounded-lg ring-1 ring-slate-600 transition-transform hover:scale-105"
    />
  )
}

function ToolButton({
  children,
  onClick,
  disabled,
  testId,
  primary,
  danger,
  ...rest
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  testId: string
  primary?: boolean
  danger?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const tone = primary
    ? 'bg-sky-500 text-slate-950 hover:bg-sky-400'
    : danger
      ? 'bg-slate-800 text-rose-300 hover:bg-rose-500/20'
      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      // 모바일에서 손가락으로 누를 수 있는 최소 크기 (PRD 6절)
      className={`min-h-11 min-w-11 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-slate-800/50 disabled:text-slate-600 ${tone}`}
      {...rest}
    >
      {children}
    </button>
  )
}

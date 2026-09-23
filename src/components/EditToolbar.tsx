import { useProject } from '../lib/project/store'
import {
  ArrowBackIcon,
  ArrowForwardIcon,
  ContentCutIcon,
  DeleteIcon,
  RedoIcon,
  UndoIcon,
} from './icons'
import { btn } from './m3'

/**
 * PRD 6절의 키보드 단축키 기준. 영상 기본 프레임율을 30fps로 보고
 * 한 프레임을 이 값으로 잡는다. 실제 프레임율에 맞추는 것은
 * 미리보기 재생 엔진과 함께 다룬다.
 */
export const FRAME_STEP = 1 / 30

export function EditToolbar({ nowrap }: { nowrap?: boolean } = {}) {
  const timeline = useProject((state) => state.timeline)
  const selectedItemId = useProject((state) => state.selectedItemId)
  const selectedSubtitleId = useProject((state) => state.selectedSubtitleId)
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

  const divider = <span className="mx-1 h-6 w-px shrink-0 bg-outline-variant" />

  const history = (
    <>
      <IconButton testId="undo" onClick={undo} disabled={past.length === 0} label="되돌리기">
        <UndoIcon size={24} />
      </IconButton>
      <IconButton testId="redo" onClick={redo} disabled={future.length === 0} label="다시 실행">
        <RedoIcon size={24} />
      </IconButton>
    </>
  )

  return (
    <div className={`flex items-center gap-2 ${nowrap ? 'w-max flex-nowrap' : 'flex-wrap'}`}>
      <button
        type="button"
        data-testid="split"
        onClick={split}
        // 모바일에서 손가락으로 누를 수 있는 최소 크기 (PRD 6절)
        className={`${btn.filled} h-11 pr-5 pl-4`}
      >
        <ContentCutIcon size={20} />
        자르기
      </button>
      <button
        type="button"
        data-testid="delete"
        onClick={removeSelected}
        // 타임라인에서 고른 자막도 같은 버튼으로 지운다.
        disabled={!hasSelection && !selectedSubtitleId}
        className={`${btn.outlined} h-11 pr-5 pl-4`}
      >
        <DeleteIcon size={20} />
        지우기
      </button>

      {/* 한 줄로 밀어 보는 모바일 바에서는 되돌리기를 앞에 둔다. 가장 자주
          쓰는데 끝에 있으면 매번 옆으로 밀어 찾아야 한다. */}
      {nowrap && divider}
      {nowrap && history}

      {divider}

      <span className="flex items-center gap-2">
        <span className="m3-label-large whitespace-nowrap text-on-surface-variant">
          빈 화면 추가
        </span>
        <BlankButton
          testId="insert-blank"
          color="#000000"
          label="검은 빈 화면 추가"
          onClick={insertBlank}
        />
        <BlankButton
          testId="insert-blank-white"
          color="#FFFFFF"
          label="흰 빈 화면 추가"
          onClick={insertBlank}
        />
      </span>

      {divider}

      <IconButton
        testId="move-back"
        onClick={() => moveSelected(-1)}
        disabled={!hasSelection || index === 0}
        label="앞으로 옮기기"
        tonal
      >
        <ArrowBackIcon size={24} />
      </IconButton>
      <IconButton
        testId="move-forward"
        onClick={() => moveSelected(1)}
        disabled={!hasSelection || index === timeline.length - 1}
        label="뒤로 옮기기"
        tonal
      >
        <ArrowForwardIcon size={24} />
      </IconButton>

      {!nowrap && divider}
      {!nowrap && history}
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
      className="state-layer h-11 w-11 shrink-0 rounded-m3-md border border-outline text-on-surface-variant"
    />
  )
}

/** 되돌리기·옮기기처럼 뜻이 분명한 동작은 아이콘만 둔다. 이름은 aria-label 로 준다. */
function IconButton({
  children,
  onClick,
  disabled,
  testId,
  label,
  tonal,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  testId: string
  label: string
  tonal?: boolean
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      // 디자인은 40px 이지만 손가락 기준(44px, PRD 6절)을 지킨다.
      className={`${tonal ? btn.iconTonal : btn.icon} h-11 w-11`}
    >
      {children}
    </button>
  )
}

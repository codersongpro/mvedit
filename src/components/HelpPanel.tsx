import { useState } from 'react'
import { ExpandLessIcon, ExpandMoreIcon } from './icons'
import { btn } from './m3'

const TIPS = [
  '눈금이나 클립을 눌러 재생 위치를 옮깁니다.',
  '클립을 고르면 양 끝을 끌어 길이를 줄이거나 늘릴 수 있습니다.',
  '자막도 타임라인에서 양 끝을 끌어 시작과 끝을 맞출 수 있습니다.',
  '타임라인의 자막을 길게 누르면(마우스는 오른쪽 클릭) 지우기 메뉴가 뜹니다.',
  '두 손가락으로 벌리거나 Ctrl+휠로 타임라인을 확대합니다.',
]

const SHORTCUTS = [
  { keys: 'Space', action: '재생 / 정지' },
  { keys: 'S', action: '재생 위치에서 자르기' },
  { keys: 'Delete', action: '고른 클립·자막 지우기' },
  { keys: '← →', action: '한 프레임 이동' },
  { keys: 'Ctrl+Z', action: '되돌리기' },
  { keys: 'Ctrl+Shift+Z', action: '다시 실행' },
]

/**
 * 조작법을 화면에 늘어놓지 않고 필요할 때만 보여 준다.
 * 편집 화면에 설명이 길게 붙어 있으면 정작 타임라인이 밀려난다.
 */
export function HelpPanel() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="help-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${btn.text} self-start pr-2`}
      >
        사용법 · 단축키 <span className="sr-only">{open ? '닫기' : '보기'}</span>
        {open ? <ExpandLessIcon size={20} /> : <ExpandMoreIcon size={20} />}
      </button>

      {open && (
        <div
          data-testid="help-panel"
          className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-6 rounded-m3-lg bg-surface-container-low p-4"
        >
          <div>
            <h3 className="mb-2 m3-title-small text-on-surface">조작법</h3>
            <ul className="flex flex-col gap-1">
              {TIPS.map((tip) => (
                <li key={tip} className="m3-body-medium text-on-surface-variant">
                  · {tip}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 m3-title-small text-on-surface">
              단축키{' '}
              <span className="m3-body-small text-on-surface-variant">(키보드가 있을 때)</span>
            </h3>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys} className="col-span-2 grid grid-cols-subgrid items-center">
                  <dt>
                    <kbd className="rounded-md bg-surface-container-highest px-2 py-0.5 font-mono m3-label-medium text-on-surface">
                      {shortcut.keys}
                    </kbd>
                  </dt>
                  <dd className="m3-body-medium text-on-surface-variant">{shortcut.action}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect } from 'react'
import { useProject } from './project/store'
import { FRAME_STEP } from '../components/EditToolbar'

/** PRD 6절 키보드 단축키. 입력란에 타자를 칠 때는 가로채지 않는다. */
export function useEditShortcuts() {
  const split = useProject((state) => state.split)
  const removeSelected = useProject((state) => state.removeSelected)
  const nudgePlayhead = useProject((state) => state.nudgePlayhead)
  const undo = useProject((state) => state.undo)
  const redo = useProject((state) => state.redo)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) {
        return
      }

      const mod = event.ctrlKey || event.metaKey

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (mod) return

      switch (event.key) {
        case 's':
        case 'S':
        case 'ㄴ':
          event.preventDefault()
          split()
          break
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          removeSelected()
          break
        case 'ArrowLeft':
          event.preventDefault()
          nudgePlayhead(-FRAME_STEP)
          break
        case 'ArrowRight':
          event.preventDefault()
          nudgePlayhead(FRAME_STEP)
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [split, removeSelected, nudgePlayhead, undo, redo])
}

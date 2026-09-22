import { useRef, useState } from 'react'
import { AddIcon, UploadIcon } from './icons'
import { btn } from './m3'

export function FilePicker({
  onSelect,
  disabled,
  compact,
}: {
  onSelect: (files: File[]) => void
  disabled?: boolean
  /** 좁은 화면에서 이미 편집 중일 때. 큰 안내 영역이 화면을 다 먹지 않게 한다. */
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length > 0) onSelect(list)
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="video/*,image/*,.cutcap"
      multiple
      className="sr-only"
      data-testid="file-input"
      onChange={(event) => {
        handleFiles(event.target.files)
        // 같은 파일을 다시 골라도 change 가 발생하도록 비운다.
        event.target.value = ''
      }}
    />
  )

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {input}
        <button
          type="button"
          disabled={disabled}
          data-testid="add-more"
          onClick={() => inputRef.current?.click()}
          className={`${btn.tonal} h-11 pl-4`}
        >
          <AddIcon size={18} />
          영상·사진 추가
        </button>
      </div>
    )
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!disabled) handleFiles(event.dataTransfer.files)
      }}
      className={`flex flex-col items-center gap-4 rounded-[28px] border-2 border-dashed px-6 py-10 text-center transition-colors duration-100 ease-m3 ${
        dragging
          ? 'border-primary bg-primary-container/40'
          : 'border-outline-variant bg-surface-container-low'
      }`}
    >
      {input}
      <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary-container text-on-primary-container">
        <UploadIcon size={32} />
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`${btn.filled} h-14 rounded-m3-lg pr-6 pl-4 text-base`}
      >
        <AddIcon size={24} />
        영상·사진 추가
      </button>
      <p className="max-w-md m3-body-small text-on-surface-variant">
        여러 개를 한 번에 고르거나 끌어다 놓을 수 있습니다. 프로젝트 파일(.cutcap)도 여기로 열 수
        있습니다.
      </p>
    </div>
  )
}

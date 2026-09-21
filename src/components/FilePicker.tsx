import { useRef, useState } from 'react'

export function FilePicker({
  onSelect,
  disabled,
}: {
  onSelect: (files: File[]) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length > 0) onSelect(list)
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
      className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        dragging ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 bg-slate-900/40'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        className="sr-only"
        data-testid="file-input"
        onChange={(event) => {
          handleFiles(event.target.files)
          // 같은 파일을 다시 골라도 change 가 발생하도록 비운다.
          event.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        영상·사진 추가
      </button>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        여러 개를 한 번에 고르거나 끌어다 놓을 수 있습니다.
        <br />
        파일은 기기 밖으로 전송되지 않습니다.
      </p>
    </div>
  )
}

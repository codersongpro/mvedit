import { useRef, useState } from 'react'

export function FilePicker({
  onSelect,
  disabled,
}: {
  onSelect: (file: File) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onSelect(file)
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
        accept="video/*"
        className="sr-only"
        data-testid="file-input"
        onChange={(event) => {
          handleFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        영상 선택
      </button>
      <p className="mt-3 text-xs text-slate-500">
        파일을 여기로 끌어다 놓아도 됩니다. 영상은 기기 밖으로 전송되지 않습니다.
      </p>
    </div>
  )
}

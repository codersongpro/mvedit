import type { RejectedFile } from '../lib/project/types'

/**
 * 불러오지 못한 파일을 알린다 (FR-003, AC-004).
 * 어떤 파일이 왜 안 됐는지 보여주지 않으면 사용자는 원인을 짐작할 수 없다.
 */
export function RejectedFiles({
  files,
  onDismiss,
}: {
  files: RejectedFile[]
  onDismiss: () => void
}) {
  if (files.length === 0) return null

  return (
    <div
      data-testid="rejected-files"
      className="rounded-xl bg-amber-500/10 p-4 ring-1 ring-amber-500/20"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-amber-200">
          {files.length}개 파일을 열지 못했습니다
        </h3>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs text-amber-300/70 hover:text-amber-200"
        >
          닫기
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {files.map((file) => (
          <li key={file.fileName} className="text-xs leading-relaxed text-amber-200/80">
            <span className="font-medium">{file.fileName}</span> — {file.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

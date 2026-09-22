import type { RejectedFile } from '../lib/project/types'
import { CloseIcon } from './icons'

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
      className="rounded-m3-md bg-tertiary-container p-4 text-on-tertiary-container"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="m3-title-small">{files.length}개 파일을 열지 못했습니다</h3>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="닫기"
          title="닫기"
          className="state-layer -m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <CloseIcon size={20} />
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {files.map((file) => (
          <li key={file.fileName} className="m3-body-small">
            <span className="font-medium">{file.fileName}</span> — {file.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

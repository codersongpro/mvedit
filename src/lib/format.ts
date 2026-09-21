/** mm:ss. 한 시간이 넘으면 h:mm:ss */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const ss = String(total % 60).padStart(2, '0')
  const mm = Math.floor(total / 60) % 60
  const hh = Math.floor(total / 3600)
  return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${String(mm).padStart(2, '0')}:${ss}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

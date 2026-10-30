export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '未知'
  if (bytes < 1024) return `${Math.round(bytes).toFixed(2)} B`

  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)

  return `${value.toFixed(2)} ${units[unitIndex]}`
}

export function formatDateTime(value: number | string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

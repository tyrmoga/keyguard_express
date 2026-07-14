export function secondsUntilTime(targetTimeStr: string): number {
  const now = new Date()
  const formats = [
    /^(\d{1,2}):(\d{2})$/,
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
    /^(\d{1,2})\s*(AM|PM)$/i,
  ]

  let hours = 0
  let minutes = 0
  let matched = false

  for (const fmt of formats) {
    const m = targetTimeStr.trim().match(fmt)
    if (!m) continue
    matched = true

    if (m[3] && m[3].toUpperCase() === "PM") {
      hours = parseInt(m[1]) === 12 ? 12 : parseInt(m[1]) + 12
      minutes = parseInt(m[2]) || 0
    } else if (m[3] && m[3].toUpperCase() === "AM") {
      hours = parseInt(m[1]) === 12 ? 0 : parseInt(m[1])
      minutes = parseInt(m[2]) || 0
    } else {
      hours = parseInt(m[1])
      minutes = parseInt(m[2])
    }

    break
  }

  if (!matched) {
    return 3600
  }

  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0)
  if (target <= now) {
    target.setDate(target.getDate() + 1)
  }

  return Math.max(1, Math.floor((target.getTime() - now.getTime()) / 1000))
}

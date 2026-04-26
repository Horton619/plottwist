// Unit helpers — internally inches as integers, displayed feet-and-inches.

export function parseInches(input) {
  if (input == null) return null
  let s = String(input).trim()
    .replace(/[\u2032\u2019]/g, "'")     // smart quotes → straight
    .replace(/[\u2033\u201d]/g, '"')
  if (!s) return null

  // 24'-6" or 24' 6" or 24'6"
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"?$/)
  if (m) {
    const ft = parseFloat(m[1])
    const inch = parseFloat(m[2])
    const sign = ft < 0 ? -1 : 1
    return Math.round(ft * 12 + sign * inch)
  }
  // 24'
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*'$/)
  if (m) return Math.round(parseFloat(m[1]) * 12)
  // 36"
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*"$/)
  if (m) return Math.round(parseFloat(m[1]))
  // bare number = inches
  m = s.match(/^(-?\d+(?:\.\d+)?)$/)
  if (m) return Math.round(parseFloat(m[1]))
  return null
}

export function formatInches(inches) {
  if (inches == null || isNaN(inches)) return ''
  const sign = inches < 0 ? '-' : ''
  const abs = Math.abs(Math.round(inches))
  const ft = Math.floor(abs / 12)
  const inch = abs - ft * 12
  if (ft === 0) return `${sign}${inch}"`
  if (inch === 0) return `${sign}${ft}'`
  return `${sign}${ft}'-${inch}"`
}

export function formatSqFt(sqInches) {
  if (sqInches == null || isNaN(sqInches)) return '–'
  return `${(sqInches / 144).toFixed(1)} ft²`
}

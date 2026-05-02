// updater.js — GitHub-release update check for PlotTwist.
//
// Calls the public GitHub API (no auth required) and compares the latest
// release tag to the running app version. Returns a { current, latest, url,
// isNewer, name, publishedAt } summary so the Settings UI can show a prompt.

const REPO = 'Horton619/plottwist'

export async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`)
  return res.json()
}

// Compare semver-ish version strings (strips leading 'v', compares numeric
// parts). Returns -1 if a < b, 0 if equal, 1 if a > b.
export function compareVersions(a, b) {
  const parse = (s) => String(s).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  const ax = parse(a), bx = parse(b)
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const av = ax[i] || 0, bv = bx[i] || 0
    if (av < bv) return -1
    if (av > bv) return  1
  }
  return 0
}

export async function checkForUpdates(currentVersion) {
  try {
    const data = await fetchLatestRelease()
    const latest = data.tag_name || ''
    const isNewer = compareVersions(currentVersion, latest) < 0
    return {
      ok: true,
      current: currentVersion,
      latest,
      isNewer,
      name: data.name || latest,
      url:  data.html_url,
      publishedAt: data.published_at,
    }
  } catch (err) {
    return { ok: false, error: err.message, current: currentVersion }
  }
}

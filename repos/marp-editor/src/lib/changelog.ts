import Cookies from 'js-cookie'

export interface ChangelogEntry {
  version: number
  date: string
  message: string
}

export const CHANGELOG_VERSION = 1

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: 1,
    date: '2026-05-24',
    message: 'Added change log functionality',
  },
]

const COOKIE_KEY = 'marp_changelog_seen'

export function getLastSeenVersion(): number {
  const raw = Cookies.get(COOKIE_KEY)
  if (!raw) return 0
  const v = parseInt(raw, 10)
  return isNaN(v) ? 0 : v
}

export function markVersionSeen(version: number): void {
  Cookies.set(COOKIE_KEY, String(version), { expires: 365, sameSite: 'lax' })
}

export function getNewEntries(): ChangelogEntry[] {
  const seen = getLastSeenVersion()
  return CHANGELOG_ENTRIES.filter(e => e.version > seen)
}

import Cookies from 'js-cookie'

const COOKIE_KEY = 'marp_session'

export interface CookieState {
  pid: string
  md: string
  css: string
  theme: string
}

export function saveToCookies(state: CookieState): void {
  try {
    const val = JSON.stringify({
      pid: state.pid,
      md: state.md.slice(0, 3000),
      css: state.css.slice(0, 1000),
      theme: state.theme,
    })
    Cookies.set(COOKIE_KEY, val, { expires: 30, sameSite: 'lax' })
  } catch {
    // cookie too large, silently fail
  }
}

export function loadFromCookies(): CookieState | null {
  const raw = Cookies.get(COOKIE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearCookies(): void {
  Cookies.remove(COOKIE_KEY)
}

export function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

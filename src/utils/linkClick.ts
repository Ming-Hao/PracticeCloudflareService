export type LinkClickResult = 'navigated' | 'stale'

export interface LinkClickDeps {
  fetch: typeof fetch
  navigate: (url: string) => void
}

const defaultDeps: LinkClickDeps = {
  fetch: globalThis.fetch.bind(globalThis),
  navigate: (url) => {
    window.location.href = url
  },
}

/**
 * Resolves a click on a short link: probes `shortUrl` first so a 404 (stale local
 * copy) can show a dialog instead of navigating, otherwise navigates.
 * The probe uses HEAD, which the server does not count as a click — only the
 * navigation's GET does, so a valid link is counted exactly once.
 */
export async function resolveLinkClick(
  shortUrl: string,
  deps: LinkClickDeps = defaultDeps,
): Promise<LinkClickResult> {
  const res = await deps.fetch(shortUrl, { method: 'HEAD' })
  if (res.status === 404) {
    return 'stale'
  }
  deps.navigate(shortUrl)
  return 'navigated'
}

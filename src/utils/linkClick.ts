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
  let res: Response
  try {
    res = await deps.fetch(shortUrl, { method: 'HEAD' })
  } catch {
    // A failed probe says nothing about the link — an ad blocker, a corporate proxy, or a
    // dropped connection all land here while the link itself is fine. Navigate anyway and
    // let the browser report: treating a failed probe as a dead link would turn an
    // enhancement into a hard dependency and lock users out of their own links.
    deps.navigate(shortUrl)
    return 'navigated'
  }
  if (res.status === 404) {
    return 'stale'
  }
  deps.navigate(shortUrl)
  return 'navigated'
}

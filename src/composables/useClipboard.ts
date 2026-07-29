import { ref } from 'vue'

export const COPY_FAILED_MESSAGE = 'Could not copy — please select the link and copy it manually.'
export const COPIED_RESET_MS = 1500

type WriteText = (text: string) => Promise<void>

/**
 * Copy-to-clipboard state for a button: whether the last copy succeeded, and the message to
 * show when it did not. Lives here rather than in the component so that its branches can be
 * tested under `node --test` — the project has no component test environment, and the failure
 * path is the one worth guarding (a clipboard rejection used to leave the button doing nothing).
 *
 * `writeText` is a parameter so tests can supply a resolving or rejecting stub instead of
 * faking `navigator`, the same seam `createHistoryStore` uses for its dependencies.
 */
export function useClipboard(writeText: WriteText = (text) => navigator.clipboard.writeText(text)) {
  const copied = ref(false)
  const error = ref('')

  async function copy(text: string): Promise<void> {
    error.value = ''
    try {
      // Rejects when the clipboard permission is denied or the page is not a secure
      // context. Unhandled, the button just does nothing and the rejection escapes —
      // Vue does not await click handlers.
      await writeText(text)
    } catch {
      error.value = COPY_FAILED_MESSAGE
      return
    }
    copied.value = true
    setTimeout(() => (copied.value = false), COPIED_RESET_MS)
  }

  return { copied, error, copy }
}

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ text: string }>()
// The failure message is emitted rather than rendered here: the two call sites in
// HomeView need it in different places (one below the result row, one inside the
// result dialog, where the outer position would be hidden behind the backdrop).
const emit = defineEmits<{ error: [message: string] }>()

const copied = ref(false)

async function onClick(text: string) {
  emit('error', '')
  try {
    // Rejects when the clipboard permission is denied or the page is not a secure
    // context. Unhandled, the button just does nothing and the rejection escapes —
    // Vue does not await click handlers.
    await navigator.clipboard.writeText(text)
  } catch {
    emit('error', 'Could not copy — please select the link and copy it manually.')
    return
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <button type="button" class="btn-primary" @click="onClick(text)">
    <svg
      v-if="!copied"
      class="btn-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
    <svg
      v-else
      class="btn-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    {{ copied ? 'Copied!' : 'Copy' }}
  </button>
</template>

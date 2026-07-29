<script setup lang="ts">
import { watch } from 'vue'
import { useClipboard } from '@/composables/useClipboard'

defineProps<{ text: string }>()
// The failure message is emitted rather than rendered here: the two call sites in
// HomeView need it in different places (one below the result row, one inside the
// result dialog, where the outer position would be hidden behind the backdrop).
const emit = defineEmits<{ error: [message: string] }>()

const { copied, error, copy } = useClipboard()
// Watched rather than emitted from a click handler so the clearing of a previous message
// still happens the moment the button is pressed, not after the clipboard write resolves.
watch(error, (message) => emit('error', message))
</script>

<template>
  <button type="button" class="btn-primary" @click="copy(text)">
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

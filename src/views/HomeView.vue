<script setup lang="ts">
import { ref, watch } from 'vue'
import { useHistory } from '@/composables/useHistory'
import HistoryTrigger from '@/components/history/HistoryTrigger.vue'
import HistoryDrawer from '@/components/history/HistoryDrawer.vue'

const url = ref('')
const shortUrl = ref('')
const error = ref('')
const loading = ref(false)
const copied = ref(false)
const dialogRef = ref<HTMLDialogElement | null>(null)
const historyOpen = ref(false)

const { addToSessionList } = useHistory()

watch(url, () => {
  error.value = ''
})

async function onSubmit() {
  error.value = ''
  shortUrl.value = ''
  loading.value = true
  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.value }),
    })
    const data = await res.json()
    if (!res.ok) {
      error.value = data.error ?? 'Something went wrong'
      return
    }
    shortUrl.value = `${window.location.origin}/${data.short_code}`
    addToSessionList({
      short_code: data.short_code,
      target_url: data.target_url,
      delete_token: data.delete_token,
      created_at: data.created_at,
    })
    dialogRef.value?.showModal()
  } catch {
    error.value = 'Network error, please try again'
  } finally {
    loading.value = false
  }
}

async function copyShortUrl() {
  await navigator.clipboard.writeText(shortUrl.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <HistoryTrigger :open="historyOpen" @toggle="historyOpen = !historyOpen" />
  <HistoryDrawer :open="historyOpen" @close="historyOpen = false" />

  <main class="shortener">
    <form @submit.prevent="onSubmit">
      <input
        v-model="url"
        type="url"
        placeholder="https://example.com/very/long/url"
        required
      />
      <button type="submit" class="btn-primary" :disabled="loading">
        <svg
          class="btn-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        {{ loading ? 'Shortening...' : 'Shorten' }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="shortUrl" class="result">
      <span class="short-url">{{ shortUrl }}</span>
      <button type="button" class="btn-primary" @click="copyShortUrl">
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
    </div>

    <dialog ref="dialogRef" class="result-dialog" @keydown.esc="dialogRef?.close()">
      <div class="dialog-header">
        <p class="dialog-title">
          <span class="dialog-icon">✓</span> Short link created!
        </p>
        <button
          type="button"
          class="btn-secondary btn-danger btn-reveal"
          aria-label="Close"
          @click="dialogRef?.close()"
        >
          <svg
            class="btn-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          <span class="btn-reveal-label">Close</span>
        </button>
      </div>
      <p class="dialog-url">{{ shortUrl }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn-primary" @click="copyShortUrl">
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
      </div>
    </dialog>
  </main>
</template>

<style scoped>
.shortener {
  max-width: 480px;
  margin: 0 auto;
}

form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

input {
  flex: none;
  width: calc(100% + 5rem);
  margin-left: -2.5rem;
  padding: 0.75rem 1rem;
  font-size: 1.1rem;
  border-radius: 0.6rem;
  border: 1px solid var(--color-border);
  background: #3a3a3a;
  color: var(--color-text);
}

input:focus {
  outline: none;
  border-color: #1e8e5a;
}

.error {
  color: #c0392b;
  margin-top: 1rem;
}

.short-url {
  color: #2ecc71;
}

.result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  word-break: break-all;
}

.result-dialog {
  position: fixed;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 320px;
  max-width: 90vw;
  margin: 0;
  padding: 1.5rem;
  border: none;
  border-radius: 0.75rem;
  background: var(--color-background-soft);
  color: var(--color-text);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  outline: none;
}

.result-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0 0 1rem;
}

.dialog-header .btn-reveal {
  padding: 0.4rem;
}

.dialog-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-weight: 600;
  color: #2ecc71;
}

.dialog-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: #2ecc71;
  color: #fff;
  font-size: 0.9rem;
}

.dialog-url {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.05rem;
  word-break: break-all;
  margin: 0 0 1.25rem;
  padding: 0.6rem 0.75rem;
  background: var(--color-background-mute);
  color: var(--color-text);
  border-radius: 0.4rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

</style>

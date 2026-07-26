<script setup lang="ts">
import { ref } from 'vue'
import { useHistory } from '@/composables/useHistory'
import HistoryItem from './HistoryItem.vue'
import PasswordPromptDialog from './PasswordPromptDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { sessionList, savedList, currentIdentity, loadFromLocal, clearAll } = useHistory()

const showLoadDialog = ref(false)
const showLoadChoice = ref(false)
const showClearConfirm = ref(false)
const loadError = ref('')

function onUnlockClick() {
  loadError.value = ''
  if (currentIdentity.value === null) {
    showLoadDialog.value = true
  } else {
    showLoadChoice.value = true
  }
}

async function onLoadCurrentIdentity() {
  showLoadChoice.value = false
  const success = await loadFromLocal(currentIdentity.value!)
  loadError.value = success ? '' : 'No saved links matched that password.'
}

function onChooseLoadDifferent() {
  showLoadChoice.value = false
  showLoadDialog.value = true
}

async function onLoadSubmit(password: string) {
  showLoadDialog.value = false
  const success = await loadFromLocal(password)
  loadError.value = success ? '' : 'No saved links matched that password.'
}

function onClearAllClick() {
  showClearConfirm.value = true
}

async function onConfirmClearAll() {
  showClearConfirm.value = false
  await clearAll()
}
</script>

<template>
  <div v-if="open" class="history-backdrop" @click="emit('close')"></div>
  <aside class="history-drawer" :class="{ open }">
    <div class="history-toolbar">
      <span class="history-toolbar-title">
        <svg
          class="btn-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="9"></circle>
          <polyline points="12 7 12 12 15 14"></polyline>
        </svg>
        History
      </span>
      <div class="history-toolbar-actions">
        <button
          v-if="sessionList.length || savedList.length"
          type="button"
          class="btn-secondary btn-danger"
          @click="onClearAllClick"
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
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
          Delete all
        </button>
        <button
          type="button"
          class="btn-secondary btn-danger btn-reveal"
          aria-label="Close history"
          @click="emit('close')"
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
    </div>

    <div class="history-body">
      <section class="history-section history-section--session">
        <h2>This session <span class="history-badge">{{ sessionList.length }}</span></h2>
        <ul v-if="sessionList.length" class="history-list">
          <HistoryItem v-for="entry in sessionList" :key="entry.short_code" :entry="entry" kind="session" />
        </ul>
        <p v-else class="history-empty">No links here right now.</p>
      </section>

      <section class="history-section history-section--saved">
        <h2>Saved <span class="history-badge">{{ savedList.length }}</span></h2>
        <template v-if="currentIdentity === null">
          <p class="history-empty">Unlock with your password to see saved links.</p>
        </template>
        <template v-else>
          <ul v-if="savedList.length" class="history-list">
            <HistoryItem v-for="entry in savedList" :key="entry.recordId" :entry="entry" kind="saved" />
          </ul>
          <p v-else class="history-empty">No saved links under this identity.</p>
        </template>
        <button type="button" class="btn-secondary" @click="onUnlockClick">Load saved links</button>
        <p v-if="loadError" class="history-item-error">{{ loadError }}</p>
      </section>
    </div>

    <PasswordPromptDialog :open="showLoadDialog" mode="load" @submit="onLoadSubmit" @cancel="showLoadDialog = false" />

    <ConfirmDialog
      :open="showLoadChoice"
      title="Load saved links"
      message="Use your currently unlocked identity, or load with a different password?"
      confirm-text="Use current identity"
      cancel-text="Load with different password…"
      @confirm="onLoadCurrentIdentity"
      @cancel="onChooseLoadDifferent"
      @dismiss="showLoadChoice = false"
    />

    <ConfirmDialog
      :open="showClearConfirm"
      title="Delete everything?"
      message="This permanently deletes every link above from the server and all local data. This cannot be undone."
      confirm-text="Delete all"
      danger
      @confirm="onConfirmClearAll"
      @cancel="showClearConfirm = false"
      @dismiss="showClearConfirm = false"
    />
  </aside>
</template>

<style scoped>
.history-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 40;
}

.history-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  background: var(--color-background-soft);
  border-left: 1px solid var(--color-border);
  box-shadow: -10px 0 40px rgba(0, 0, 0, 0.4);
  transform: translateX(100%);
  transition: transform 0.2s ease;
  z-index: 50;
}

.history-drawer.open {
  transform: translateX(0);
}

.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.history-toolbar-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-heading);
}

.history-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.history-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.25rem;
}

.history-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: var(--color-background-mute);
  border-radius: 0 0.6rem 0.6rem 0;
  border-left: 3px solid #2ecc71;
  padding: 1rem 1rem 1rem 0.85rem;
}

.history-section--saved {
  border-left-color: #3498db;
}

.history-section .btn-secondary:hover {
  background: var(--color-border-hover);
}

.history-section h2 {
  margin: 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-heading);
  opacity: 0.85;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.history-badge {
  background: var(--color-border-hover);
  color: var(--color-heading);
  font-size: 0.7rem;
  padding: 0.05rem 0.45rem;
  border-radius: 1rem;
  text-transform: none;
  letter-spacing: 0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-empty {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
}

.history-item-error {
  margin: 0;
  font-size: 0.85rem;
  color: #c0392b;
}
</style>

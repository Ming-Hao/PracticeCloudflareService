<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHistory, type HistoryEntry, type SavedEntry } from '@/composables/useHistory'
import PasswordPromptDialog from './PasswordPromptDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{
  entry: HistoryEntry | SavedEntry
  kind: 'session' | 'saved'
}>()

const { currentIdentity, deleteSessionItem, deleteSavedItem, saveToLocal, discardOldRecord, removeStaleLocalOnly } =
  useHistory()

const shortUrl = computed(() => `${window.location.origin}/${props.entry.short_code}`)
const errorMessage = ref('')
const copied = ref(false)

type DialogKind =
  | 'none'
  | 'confirm-delete'
  | 'confirm-save-choice'
  | 'password'
  | 'confirm-stale'
  | 'confirm-discard-old'

const activeDialog = ref<DialogKind>('none')
const passwordMode = ref<'save-new' | 'save-as'>('save-new')
const pendingOldRecordId = ref<string | null>(null)

function isSaved(entry: HistoryEntry | SavedEntry): entry is SavedEntry {
  return 'recordId' in entry
}

function closeDialog() {
  activeDialog.value = 'none'
}

function onSaveClick() {
  errorMessage.value = ''
  // "Save as…" (already-saved entries) always means picking a new password —
  // it's already saved under the current identity, so that choice is redundant.
  if (isSaved(props.entry)) {
    passwordMode.value = 'save-as'
    activeDialog.value = 'password'
  } else if (!currentIdentity.value) {
    passwordMode.value = 'save-new'
    activeDialog.value = 'password'
  } else {
    activeDialog.value = 'confirm-save-choice'
  }
}

async function onSaveToCurrentIdentity() {
  closeDialog()
  try {
    await saveToLocal(props.entry)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save'
  }
}

function onChooseSaveAs() {
  passwordMode.value = 'save-as'
  activeDialog.value = 'password'
}

async function onPasswordSubmit(password: string) {
  const previousRecordId = isSaved(props.entry) ? props.entry.recordId : undefined
  closeDialog()
  try {
    const result = await saveToLocal(props.entry, { password, previousRecordId })
    if (result.previousRecordId) {
      pendingOldRecordId.value = result.previousRecordId
      activeDialog.value = 'confirm-discard-old'
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save'
  }
}

async function onConfirmDiscardOld() {
  const recordId = pendingOldRecordId.value
  closeDialog()
  pendingOldRecordId.value = null
  if (recordId) {
    await discardOldRecord(recordId)
  }
}

function onDeleteClick() {
  errorMessage.value = ''
  activeDialog.value = 'confirm-delete'
}

async function onConfirmDelete() {
  closeDialog()
  try {
    if (isSaved(props.entry)) {
      await deleteSavedItem(props.entry)
    } else {
      await deleteSessionItem(props.entry)
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to delete'
  }
}

async function onLinkClick() {
  errorMessage.value = ''
  // redirect: 'manual' lets us read a 404 response directly, while a real redirect
  // comes back as an opaque response we can't (and don't need to) inspect.
  const res = await fetch(shortUrl.value, { redirect: 'manual' })
  if (res.status === 404) {
    activeDialog.value = 'confirm-stale'
    return
  }
  window.location.href = shortUrl.value
}

function onConfirmStale() {
  closeDialog()
  removeStaleLocalOnly(props.entry)
}

async function copyShortUrl() {
  await navigator.clipboard.writeText(shortUrl.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <li class="history-item">
    <div class="history-item-info">
      <div class="history-item-code-row">
        <a :href="shortUrl" class="history-item-code" @click.prevent="onLinkClick">{{ shortUrl }}</a>
        <button type="button" class="copy-btn" title="Copy link" @click="copyShortUrl">
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
        </button>
      </div>
      <span class="history-item-target">{{ entry.target_url }}</span>
    </div>
    <div class="history-item-actions">
      <button type="button" class="btn-secondary" @click="onSaveClick">
        <svg
          class="btn-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        {{ kind === 'session' ? 'Save' : 'Save as…' }}
      </button>
      <button type="button" class="btn-secondary btn-danger" @click="onDeleteClick">
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
        Delete
      </button>
    </div>
    <p v-if="errorMessage" class="history-item-error">{{ errorMessage }}</p>

    <ConfirmDialog
      :open="activeDialog === 'confirm-delete'"
      title="Delete this link?"
      message="This permanently deletes the short link from the server."
      confirm-text="Delete"
      danger
      @confirm="onConfirmDelete"
      @cancel="closeDialog"
      @dismiss="closeDialog"
    />

    <ConfirmDialog
      :open="activeDialog === 'confirm-save-choice'"
      title="Save this link"
      message="Use your currently unlocked identity, or save it with a new password?"
      confirm-text="Use current identity"
      cancel-text="Save with new password…"
      @confirm="onSaveToCurrentIdentity"
      @cancel="onChooseSaveAs"
      @dismiss="closeDialog"
    />

    <ConfirmDialog
      :open="activeDialog === 'confirm-discard-old'"
      title="Remove old local copy?"
      message="This link is now also saved under the new password. Delete the copy stored under the old password?"
      confirm-text="Delete old copy"
      cancel-text="Keep both"
      @confirm="onConfirmDiscardOld"
      @cancel="closeDialog"
      @dismiss="closeDialog"
    />

    <ConfirmDialog
      :open="activeDialog === 'confirm-stale'"
      title="Link no longer exists"
      message="This short link was not found on the server. Remove it from your local list?"
      confirm-text="Remove"
      @confirm="onConfirmStale"
      @cancel="closeDialog"
      @dismiss="closeDialog"
    />

    <PasswordPromptDialog
      :open="activeDialog === 'password'"
      :mode="passwordMode"
      @submit="onPasswordSubmit"
      @cancel="closeDialog"
    />
  </li>
</template>

<style scoped>
.history-item {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
}

.history-item-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.history-item-code-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.history-item-code {
  color: #2ecc71;
  font-weight: 600;
  text-decoration: none;
  word-break: break-all;
}

.history-item-code:hover {
  text-decoration: underline;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0.15rem;
  border: none;
  background: transparent;
  color: var(--color-heading);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

.history-item-code-row:hover .copy-btn,
.history-item-code-row:focus-within .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  color: #2ecc71;
}

.history-item-target {
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
  word-break: break-all;
}

.history-item-actions {
  display: flex;
  gap: 0.5rem;
}

.history-item-error {
  margin: 0;
  font-size: 0.85rem;
  color: #c0392b;
}
</style>

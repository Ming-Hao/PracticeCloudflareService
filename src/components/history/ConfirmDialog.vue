<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
  dismiss: []
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) dialogRef.value?.showModal()
    else dialogRef.value?.close()
  },
)

// Esc / native <dialog> cancel is a plain dismissal, distinct from the cancel-text
// button: some callers reuse cancel-text for a real alternate action (e.g. "Save
// with new password…"), which Esc must never trigger.
function onDismiss() {
  emit('dismiss')
}

function onCancelClick() {
  emit('cancel')
}

function onConfirm() {
  emit('confirm')
}
</script>

<template>
  <dialog
    ref="dialogRef"
    class="confirm-dialog"
    :class="{ danger }"
    @cancel.prevent="onDismiss"
    @keydown.esc="onDismiss"
  >
    <p class="confirm-title">{{ title }}</p>
    <p class="confirm-message">{{ message }}</p>
    <div class="confirm-actions">
      <button type="button" class="btn-secondary" @click="onCancelClick">{{ cancelText ?? 'Cancel' }}</button>
      <button type="button" class="btn-primary" :class="{ 'btn-danger': danger }" @click="onConfirm">
        {{ confirmText ?? 'Confirm' }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.confirm-dialog {
  position: fixed;
  top: 50%;
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
}

.confirm-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.confirm-title {
  margin: 0 0 0.75rem;
  font-weight: 600;
}

.confirm-dialog.danger .confirm-title {
  color: #e74c3c;
}

.confirm-message {
  margin: 0 0 1.25rem;
  color: var(--color-text);
  opacity: 0.85;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>

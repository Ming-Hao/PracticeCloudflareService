<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  mode: 'save-new' | 'load' | 'save-as'
}>()

const emit = defineEmits<{
  submit: [password: string]
  cancel: []
}>()

const password = ref('')
const dialogRef = ref<HTMLDialogElement | null>(null)

const title = computed(() => {
  if (props.mode === 'load') return 'Enter password to load saved links'
  if (props.mode === 'save-as') return 'Save with a new password'
  return 'Set a password to save this link'
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      password.value = ''
      dialogRef.value?.showModal()
    } else {
      dialogRef.value?.close()
    }
  },
)

function onCancel() {
  emit('cancel')
}

function onSubmit() {
  if (!password.value) return
  emit('submit', password.value)
}
</script>

<template>
  <dialog ref="dialogRef" class="password-dialog" @cancel.prevent="onCancel" @keydown.esc="onCancel">
    <p class="password-title">{{ title }}</p>
    <form @submit.prevent="onSubmit">
      <input
        v-model="password"
        type="password"
        placeholder="Password"
        required
        autofocus
        minlength="4"
        maxlength="30"
      />
      <p class="password-hint">Must be 4–30 characters.</p>
      <p class="password-hint">
        This is not an account password and there is no recovery — if you forget it, this data is lost for good.
      </p>
      <div class="password-actions">
        <button type="button" class="btn-secondary" @click="onCancel">Cancel</button>
        <button type="submit" class="btn-primary">Continue</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.password-dialog {
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

.password-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.password-title {
  margin: 0 0 1rem;
  font-weight: 600;
}

.password-dialog input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.6rem 0.75rem;
  font-size: 1rem;
  border-radius: 0.4rem;
  border: 1px solid var(--color-border);
  background: var(--color-background-mute);
  color: var(--color-text);
}

.password-hint {
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
}

.password-hint + .password-hint {
  margin-top: 0.3rem;
}

.password-hint:last-of-type {
  margin-bottom: 1.25rem;
}

.password-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>

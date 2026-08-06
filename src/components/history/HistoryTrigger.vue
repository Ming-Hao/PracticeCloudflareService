<script setup lang="ts">
import { useHistory } from '@/composables/useHistory'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()

const { badgeCount } = useHistory()
</script>

<template>
  <button type="button" class="history-trigger" :class="{ active: open }" @click="emit('toggle')">
    <svg
      class="history-trigger-icon"
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
    <span>History</span>
    <span v-if="badgeCount > 0" class="history-trigger-badge">{{ badgeCount }}</span>
  </button>
</template>

<style scoped>
.history-trigger {
  position: fixed;
  top: 1.25rem;
  right: 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  z-index: 30;
}

.history-trigger:hover,
.history-trigger.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.history-trigger-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.history-trigger-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--color-accent-surface);
  color: #fff;
  font-size: 0.75rem;
  line-height: 1;
}
</style>

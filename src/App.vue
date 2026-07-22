<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <header>
    <h1>Shorten Your Links</h1>
  </header>

  <section class="how-it-works">
    <h2>How it works</h2>
    <ol>
      <li>Paste a long URL below</li>
      <li>Click "Shorten"</li>
      <li>Copy the short link</li>
    </ol>
  </section>

  <RouterView />
</template>

<style scoped>
header {
  text-align: center;
  padding: 2rem 0 1rem;
}

header h1 {
  color: #e67e22;
}

.how-it-works {
  max-width: 480px;
  margin: 0 auto 1.5rem;
  padding: 1rem 1.25rem;
  background: var(--color-background-soft);
  color: var(--color-text);
  border-radius: 0.5rem;
}

.how-it-works h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.how-it-works ol {
  margin: 0;
  padding-left: 1.25rem;
}
</style>

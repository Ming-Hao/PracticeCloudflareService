<script setup lang="ts">
import { RouterView } from 'vue-router'

import AppFooter from '@/components/AppFooter.vue'
</script>

<template>
  <div class="page-content">
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
  </div>

  <AppFooter />
</template>

<style scoped>
/* The single flex item inside #app: it grows to fill the viewport, which is what
   holds AppFooter at the bottom. Everything inside is plain block flow, so the
   `margin: 0 auto` centering below keeps working — as a flex item it would not,
   because a cross-axis auto margin cancels `align-items: stretch` and shrinks
   the box to its content. `padding-bottom` is the minimum gap above the footer. */
.page-content {
  flex: 1 0 auto;
  padding-bottom: 3rem;
}

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

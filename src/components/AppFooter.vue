<script setup lang="ts">
const REPO_URL = 'https://github.com/Ming-Hao/PracticeCloudflareService'

const version = __APP_VERSION__
// Empty when the build had neither CF_PAGES_COMMIT_SHA nor a usable git checkout.
const commit = __APP_COMMIT__
const commitUrl = `${REPO_URL}/commit/${commit}`
</script>

<template>
  <footer class="site-footer">
    <div class="build">
      <span class="version">v{{ version }}</span>

      <span class="repo-group">
        <a class="repo" :href="REPO_URL" target="_blank" rel="noopener noreferrer">
          <svg class="repo-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            />
          </svg>
          GitHub
        </a>

        <a
          v-if="commit"
          class="hash"
          :href="commitUrl"
          target="_blank"
          rel="noopener noreferrer"
        >#{{ commit }}</a>
      </span>
    </div>

    <p class="deploy">
      Deployed with Cloudflare Pages
      <svg class="deploy-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727"
        />
      </svg>
    </p>
  </footer>
</template>

<style scoped>
.site-footer {
  /* No top margin: `.page-content` in App.vue grows to fill #app and pushes this
     down, and owns the gap above the rule via its own padding-bottom. */
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  color: var(--color-text);
}

.build {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.version {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

/* The link and the hash share one hover group, so the pointer can travel
   between them without the hash turning unreachable half way across. */
.repo-group {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.repo {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95rem;
  color: var(--color-text-muted);
  text-decoration: none;
}

.repo-icon {
  width: 20px;
  height: 20px;
  flex: none;
}

.hash {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  text-decoration: none;
}

.deploy {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.95rem;
  color: var(--color-text-muted);
}

/* Cloudflare orange, the one saturated colour down here — it reads as a logo
   rather than as another grey glyph, so it keeps its brand fill on hover too. */
.deploy-icon {
  width: 22px;
  height: 22px;
  fill: #f6821f;
  flex: none;
  /* .deploy dimmed the mark along with its text until the text moved to
     --color-text-muted. A brand logo carries no contrast requirement, so the
     dimming stays here rather than being dropped. */
  opacity: 0.6;
}

/* Everything in here is scoped to pointers that can hover: a touch device never
   hides the hash, so it needs no rule of its own to show it again. */
@media (hover: hover) {
  .repo {
    transition: color 0.25s;
  }

  /* Hidden at rest, and not a click target while invisible. */
  .hash {
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.25s,
      color 0.25s;
  }

  .repo-group:hover .hash {
    opacity: 1;
    pointer-events: auto;
  }

  .repo:hover,
  .hash:hover {
    color: var(--color-accent);
  }
}
</style>

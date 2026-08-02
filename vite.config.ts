import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const COMMIT_HASH_LENGTH = 7

const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
)

// Cloudflare Pages sets CF_PAGES_COMMIT_SHA in its build environment; git is the
// local fallback. An empty string means "unknown" and hides the footer segment.
function resolveCommitHash(): string {
  const fromPages = process.env.CF_PAGES_COMMIT_SHA
  if (fromPages) {
    return fromPages.slice(0, COMMIT_HASH_LENGTH)
  }

  try {
    return execFileSync('git', ['rev-parse', `--short=${COMMIT_HASH_LENGTH}`, 'HEAD'], {
      encoding: 'utf-8',
    }).trim()
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(resolveCommitHash()),
  },
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
})

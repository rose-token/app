import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build hash for cache busting - injected at Docker build time
// This ensures Vite generates new file hashes on every deploy
const buildHash = process.env.VITE_BUILD_HASH || 'dev'

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    global: 'globalThis',
    // Inject build hash as a global constant - forces bundle hash to change
    __BUILD_HASH__: JSON.stringify(buildHash),
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'build',
  },
  resolve: {
    alias: {
      // Add polyfills for Node.js modules if needed
      buffer: 'buffer',
      process: 'process/browser',
    },
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
    // Strip console.log in production builds for performance
    // TEMPORARILY DISABLED for debugging governance deposit/propose errors
    drop: [], // process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
      define: {
        global: 'globalThis',
      },
    },
  },
})
 
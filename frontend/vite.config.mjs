import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    global: 'globalThis',
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
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
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

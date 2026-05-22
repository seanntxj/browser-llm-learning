import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import basicSsl from "@vitejs/plugin-basic-ssl"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Expose to the local network so phones/other machines can connect
    host: true,
    headers: {
      // Required for SharedArrayBuffer (WASM multi-threading fallback).
      // Without these, Transformers.js WASM crashes on non-localhost devices.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // CRITICAL FOR WEB WORKERS & LOCAL LLMS
  worker: {
    format: 'es', // Bundles the worker file as an ES Module
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
})

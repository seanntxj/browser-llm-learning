import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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

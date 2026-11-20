import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  // The debug view loads the physics package's reference fixtures from the workspace.
  server: { fs: { allow: ["../.."] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        debug: resolve(import.meta.dirname, "debug.html"),
      },
    },
  },
})

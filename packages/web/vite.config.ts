import { defineConfig } from "vite"

export default defineConfig({
  // The debug view loads the physics package's reference fixtures from the workspace.
  server: { fs: { allow: ["../.."] } },
})

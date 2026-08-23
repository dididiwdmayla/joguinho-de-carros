import { defineConfig } from 'vite'

// Static site build only: no dev server / preview configuration here.
// The output goes to dist/, which is what Vercel publishes.
export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    // public/ already owns dist/assets/**, so bundle output goes elsewhere and
    // the two can never collide.
    assetsDir: 'build',
    // Data files (src/data/**.json) are imported with `?url` and fetched at
    // runtime. Keep them as real emitted files instead of inlined data: URIs
    // so they stay inspectable in the deployed build.
    assetsInlineLimit: 0,
  },
})

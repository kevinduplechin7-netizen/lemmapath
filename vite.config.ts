import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Prevent mixed‑case asset hashes (which can break deploys on case‑sensitive hosts
  // or if a deploy pipeline normalizes filenames). Hex hashes are lower‑case only.
  build: {
    rollupOptions: {
      output: {
        hashCharacters: "hex"
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Avoid generating a separate /registerSW.js file (another source of case‑mismatch).
      injectRegister: "inline",
      includeAssets: [],
      manifest: {
        name: "LemmaPath",
        short_name: "LemmaPath",
        description: "Local-first sentence repetition with TTS + Excel import.",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#6b4f3a",
        background_color: "#f6f1ea",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      }
    })
  ]
});

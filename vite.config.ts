import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Prevent mixed-case asset hashes (helps on case-sensitive hosts).
  build: {
    rollupOptions: {
      output: {
        hashCharacters: "hex",
        // Keep initial load light by splitting core vendors.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react") || id.includes("react-dom")) return "react";
          if (id.includes("dexie")) return "dexie";
          return "vendor";
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // We register the service worker manually in App.tsx so we can show an "Update available" banner.
      injectRegister: null,
      includeAssets: [],
      manifest: {
        name: "Sentence Paths",
        short_name: "Sentence Paths",
        description: "Local-first bilingual sentence reading + spaced repetition with TTS and spreadsheet import.",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      }
    })
  ]
});

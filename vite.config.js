import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      // Switched from the default "generateSW" mode to "injectManifest":
      // generateSW auto-builds a service worker with no way to add our own
      // push/notificationclick listeners. injectManifest instead takes a
      // service worker file we control (src/sw.js) and just injects the
      // precache file list into it at build time.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      manifest: {
        name: "Brotherhood Future Fund",
        short_name: "BFF Fund",
        description: "Brotherhood Future Fund — member share & payment tracker",
        theme_color: "#05070d",
        background_color: "#05070d",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      // Same offline-caching intent as before, just living under
      // injectManifest instead of workbox (which only applies to
      // generateSW mode and would now be silently ignored).
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
      },
    }),
  ],
});

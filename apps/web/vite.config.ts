import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const pwaMode = process.env.EULESIA_PWA_MODE ?? "disabled";

if (!["enabled", "self-destroying", "disabled"].includes(pwaMode)) {
  throw new Error(`Unsupported EULESIA_PWA_MODE: ${pwaMode}`);
}

const enablePwaManifest = pwaMode === "enabled";
const selfDestroyingPwa = pwaMode === "self-destroying";
const disablePwa = pwaMode === "disabled";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      disable: disablePwa,
      // Test builds use a self-destroying worker so old registrations clean
      // themselves up without requiring a manual cache purge.
      selfDestroying: selfDestroyingPwa,
      registerType: "autoUpdate",
      includeAssets: enablePwaManifest
        ? ["favicon.svg", "icons/*.webp"]
        : undefined,
      manifest: enablePwaManifest
        ? {
            name: "Eulesia",
            short_name: "Eulesia",
            description: "Eurooppalainen kansalaisdemokratia-alusta",
            start_url: "/agora",
            display: "standalone",
            background_color: "#1e3a8a",
            theme_color: "#1e3a8a",
            orientation: "portrait-primary",
            icons: [
              {
                src: "/icons/icon-48.webp",
                sizes: "48x48",
                type: "image/webp",
              },
              {
                src: "/icons/icon-72.webp",
                sizes: "72x72",
                type: "image/webp",
              },
              {
                src: "/icons/icon-96.webp",
                sizes: "96x96",
                type: "image/webp",
              },
              {
                src: "/icons/icon-128.webp",
                sizes: "128x128",
                type: "image/webp",
              },
              {
                src: "/icons/icon-192.webp",
                sizes: "192x192",
                type: "image/webp",
                purpose: "any",
              },
              {
                src: "/icons/icon-256.webp",
                sizes: "256x256",
                type: "image/webp",
              },
              {
                src: "/icons/icon-512.webp",
                sizes: "512x512",
                type: "image/webp",
                purpose: "any maskable",
              },
            ],
          }
        : false,
      workbox: {
        importScripts: ["/sw-push.js"],
        globPatterns: ["**/*.{js,css,html,svg,webp,woff,woff2}"],
        // Activate new SW immediately — don't wait for all tabs to close
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Cache locale files
            urlPattern: /\/locales\/.*\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "eulesia-locales",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React + router
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // Data fetching
          "vendor-data": ["@tanstack/react-query"],
          // i18n
          "vendor-i18n": [
            "i18next",
            "react-i18next",
            "i18next-http-backend",
            "i18next-browser-languagedetector",
          ],
          // Map
          "vendor-map": ["maplibre-gl"],
          // Icons
          "vendor-icons": ["lucide-react"],
          // Sanitization
          "vendor-sanitize": ["dompurify"],
        },
      },
    },
  },
});

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Numéro de cette mise en ligne : l'app compare le sien à `version.json` (src/lib/appUpdate.ts).
const APP_VERSION = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);
const appVersion = (): Plugin => ({
  name: "ttp-app-version",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ v: APP_VERSION }) });
  },
});

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [react(), tailwindcss(), appVersion()],
  define: { __APP_VERSION__: JSON.stringify(command === "build" ? APP_VERSION : "dev") },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      // Deux pages : l'app, et l'accord du connecteur Claude (/connecteur/).
      input: {
        main: path.resolve(__dirname, "index.html"),
        connecteur: path.resolve(__dirname, "connecteur/index.html"),
      },
      output: {
        // Vendors STABLES isolés du code applicatif : comme on déploie en continu sur
        // `main`, chaque push n'invalide plus le gros socle React/motion en cache
        // navigateur — seul le chunk applicatif modifié est re-téléchargé.
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          )
            return "react";
          if (id.includes("node_modules/motion") || id.includes("node_modules/framer-motion")) return "motion";
        },
      },
    },
  },
}));

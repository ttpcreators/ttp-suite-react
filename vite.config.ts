/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createHash } from "crypto";

// Numéro de cette mise en ligne : l'app compare le sien à `version.json` (src/lib/appUpdate.ts).
const APP_VERSION = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);
const appVersion = (): Plugin => ({
  name: "ttp-app-version",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ v: APP_VERSION }) });
  },
});

// CSP des pages construites : les scripts viennent de l'app elle-même ('self'), plus les
// scripts écrits dans la page (le thème de index.html), autorisés par leur empreinte calculée
// ici. Seulement au build : le serveur de dev ajoute ses propres scripts dans la page.
const scriptSrcCsp = (): Plugin => ({
  name: "ttp-csp-script-src",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(html) {
      const empreintes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
      );
      const scriptSrc = ["script-src 'self'", ...empreintes].join(" ");
      let pose = false;
      const out = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (_m, avant: string, csp: string, apres: string) => {
        pose = true;
        return `${avant}${csp.replace(/;\s*script-src[^;]*/, "")}; ${scriptSrc}${apres}`;
      });
      if (!pose) throw new Error("CSP absente de la page : balise Content-Security-Policy attendue");
      return out;
    },
  },
});

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [react(), tailwindcss(), appVersion(), scriptSrcCsp()],
  define: { __APP_VERSION__: JSON.stringify(command === "build" ? APP_VERSION : "dev") },
  // Les copies de travail des agents (.claude/worktrees) ne sont pas testées avec l'app.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
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

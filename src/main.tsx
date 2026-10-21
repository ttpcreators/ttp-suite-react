import { StrictMode } from 'react'
import { startUpdateWatch } from './lib/appUpdate'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary, recoverStaleApp } from './components/ErrorBoundary.tsx'
import { initAccent } from './lib/accent'
import { initIosUi } from './lib/iosUi'
import { installGlobalErrorReporting } from './lib/errorReport'
import { initDeepLinks } from './lib/deepLink'
import { Tooltips } from './components/ui/tooltips'

// Couleur d'accent personnalisée (localStorage) posée AVANT le rendu → pas de flash.
initAccent()
// Mode iPhone (bêta, propre à l'appareil) : classe `ios-ui` posée avant le rendu.
initIosUi()
// iOS n'applique l'état :active (retour visuel au toucher) que si la page écoute les touchers.
document.addEventListener('touchstart', () => {}, { passive: true })

// Tout bug non rattrapé (JS, action qui échoue) est remonté : journal + alerte agence.
installGlobalErrorReporting()

// Lien d'ouverture d'une notification (« /?open=mails&thread=… ») : lu une fois, retiré
// de l'adresse ; ceux qui arrivent app ouverte passent par le service worker.
initDeepLinks()

// Après un déploiement, l'app restée ouverte peut demander un ancien chunk (hash
// remplacé) → Vite émet `vite:preloadError`. On remet l'app à jour automatiquement ;
// si ça ne suffit pas, l'erreur suit son cours et l'écran propose un bouton.
window.addEventListener('vite:preloadError', (e) => {
  if (recoverStaleApp()) e.preventDefault()
})
// Nouvelle version en ligne : repérée à l'avance, chargée à la page suivante (sans écran d'erreur).
startUpdateWatch()

// Service worker dès le démarrage (avant : seulement en activant les notifications) :
// il garde les fichiers de l'app sur l'appareil → ouverture rapide, même sans réseau.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary variant="full">
      <App />
      {/* Bulles d'aide aux couleurs de l'app pour tous les `title` (agence et créateur). */}
      <Tooltips />
    </ErrorBoundary>
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary, reloadOnce } from './components/ErrorBoundary.tsx'
import { initAccent } from './lib/accent'
import { initIosUi } from './lib/iosUi'
import { installGlobalErrorReporting } from './lib/errorReport'

// Couleur d'accent personnalisée (localStorage) posée AVANT le rendu → pas de flash.
initAccent()
// Mode iPhone (bêta, propre à l'appareil) : classe `ios-ui` posée avant le rendu.
initIosUi()
// iOS n'applique l'état :active (retour visuel au toucher) que si la page écoute les touchers.
document.addEventListener('touchstart', () => {}, { passive: true })

// Tout bug non rattrapé (JS, action qui échoue) est remonté : journal + alerte agence.
installGlobalErrorReporting()

// Après un déploiement, l'app restée ouverte peut demander un ancien chunk (hash
// remplacé) → Vite émet `vite:preloadError`. On recharge automatiquement (1×)
// pour récupérer le nouveau bundle au lieu de casser la navigation.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadOnce()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary variant="full">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

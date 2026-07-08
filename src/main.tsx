import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary, reloadOnce } from './components/ErrorBoundary.tsx'

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

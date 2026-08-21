import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Mantine's CSS is imported from index.css (layered below Tailwind — see comment there)
import './index.css'
import { MantineProvider } from '@mantine/core'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <App />
    </MantineProvider>
  </StrictMode>,
)

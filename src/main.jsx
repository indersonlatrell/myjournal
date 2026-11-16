import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import { DirectionProvider } from '@/components/foundations/direction/direction'
import { MotionConfig } from 'framer-motion'
import '@/src/styles/app.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DirectionProvider locale="en-US">
      <MotionConfig reducedMotion="user"><App /></MotionConfig>
    </DirectionProvider>
  </StrictMode>,
)

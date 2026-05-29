import React from 'react'
import { createRoot } from 'react-dom/client'
import Check from './Check.jsx'
import './styles.css'

const root = createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <Check />
  </React.StrictMode>
)

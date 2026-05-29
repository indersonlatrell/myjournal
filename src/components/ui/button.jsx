import React from 'react'

export function Button({ children, className = '', ...props }) {
  return (
    <button {...props} className={className}>
      {children}
    </button>
  )
}

export default Button

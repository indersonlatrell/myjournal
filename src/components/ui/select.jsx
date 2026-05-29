import React, { createContext, useContext, useState } from 'react'

const SelectContext = createContext(null)

export function Select({ value: valueProp, onValueChange, children }) {
  const [value, setValue] = useState(valueProp)

  React.useEffect(() => {
    setValue(valueProp)
  }, [valueProp])

  function setAndNotify(v) {
    setValue(v)
    onValueChange && onValueChange(v)
  }

  return (
    <SelectContext.Provider value={{ value, setValue: setAndNotify }}>
      <div>{children}</div>
    </SelectContext.Provider>
  )
}

export function SelectTrigger({ children, className = '' }) {
  return <div className={className}>{children}</div>
}

export function SelectValue({ placeholder = '' }) {
  const ctx = useContext(SelectContext)
  return <span>{ctx?.value || placeholder}</span>
}

export function SelectContent({ children }) {
  return <div>{children}</div>
}

export function SelectItem({ value, children }) {
  const ctx = useContext(SelectContext)
  return (
    <div
      style={{ padding: '6px 8px', cursor: 'pointer' }}
      onClick={() => ctx?.setValue?.(value)}
    >
      {children}
    </div>
  )
}

export default Select

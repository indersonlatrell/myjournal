import React, { createContext, useContext, useState } from 'react'

const TabsContext = createContext(null)

export function Tabs({ defaultValue, children, className = '' }) {
  const [value, setValue] = useState(defaultValue)
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ children, className = '' }) {
  return <div className={className}>{children}</div>
}

export function TabsTrigger({ value, children, className = '' }) {
  const ctx = useContext(TabsContext)
  const active = ctx?.value === value
  return (
    <button
      className={className + (active ? ' active' : '')}
      onClick={() => ctx?.setValue?.(value)}
    >
      {children}
    </button>
  )
}

export function TabsContent({ value, children, className = '' }) {
  const ctx = useContext(TabsContext)
  return <div className={className} style={{ display: ctx?.value === value ? undefined : 'none' }}>{children}</div>
}

export default Tabs

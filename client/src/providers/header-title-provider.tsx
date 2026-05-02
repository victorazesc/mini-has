"use client"

import { createContext, useContext, useState } from "react"

type HeaderTitleContextValue = {
  title: React.ReactNode | string | null
  setTitle: (value: React.ReactNode | string | null) => void
  rightAction: React.ReactNode | null
  setRightAction: (value: React.ReactNode | null) => void
}

const HeaderTitleContext = createContext<HeaderTitleContextValue | null>(null)

export function HeaderTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<React.ReactNode | string | null>(null)
  const [rightAction, setRightAction] = useState<React.ReactNode | null>(null)

  return (
    <HeaderTitleContext.Provider value={{ title, setTitle, rightAction, setRightAction }}>
      {children}
    </HeaderTitleContext.Provider>
  )
}

export function useHeaderTitle() {
  const context = useContext(HeaderTitleContext)

  if (!context) {
    throw new Error("useHeaderTitle deve ser usado dentro de HeaderTitleProvider")
  }

  return context
}

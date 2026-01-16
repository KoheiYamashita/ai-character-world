'use client'

import dynamic from 'next/dynamic'

const PixiApp = dynamic(() => import('./PixiApp'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-900 animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading...</span>
    </div>
  ),
})

export function GameCanvas() {
  return (
    <div className="w-full h-full">
      <PixiApp />
    </div>
  )
}

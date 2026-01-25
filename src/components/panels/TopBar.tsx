'use client'

import { useWorldStore, useCharacterStore } from '@/stores'

function formatTime(hour: number, minute: number): string {
  const hh = hour.toString().padStart(2, '0')
  const mm = minute.toString().padStart(2, '0')
  return `${hh}:${mm}`
}

export function TopBar(): React.ReactNode {
  const time = useWorldStore((s) => s.time)
  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())

  return (
    <div className="h-10 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-2 text-slate-100">
        <span className="text-slate-400">📅</span>
        <span className="font-medium">{time.day}日目</span>
        <span className="font-mono text-lg">{formatTime(time.hour, time.minute)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-slate-400">💰</span>
        <span className="font-medium text-green-400">
          ¥{activeCharacter?.money.toLocaleString() ?? 0}
        </span>
      </div>
    </div>
  )
}

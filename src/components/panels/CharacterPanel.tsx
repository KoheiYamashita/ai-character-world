'use client'

import { useWorldStore, useCharacterStore } from '@/stores'
import { getMaps } from '@/data/maps'
import type { ActionId } from '@/types/action'

const ACTION_LABELS: Record<ActionId, string> = {
  eat: '🍽️ 食事中',
  sleep: '💤 睡眠中',
  toilet: '🚻 トイレ中',
  bathe: '🛁 入浴中',
  rest: '☕ 休憩中',
  talk: '💬 会話中',
  work: '💼 仕事中',
  thinking: '🤔 考え中',
}

const STAT_LABELS: Record<string, { label: string; color: string }> = {
  satiety: { label: '満腹', color: 'bg-orange-500' },
  energy: { label: '体力', color: 'bg-green-500' },
  hygiene: { label: '清潔', color: 'bg-blue-500' },
  mood: { label: '気分', color: 'bg-pink-500' },
  bladder: { label: 'WC', color: 'bg-yellow-500' },
}

interface CompactStatBarProps {
  label: string
  value: number
  color: string
}

function CompactStatBar({ label, value, color }: CompactStatBarProps): React.ReactNode {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 text-xs w-8">{label}</span>
      <div className="flex-1 h-3 bg-slate-700 rounded overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  )
}

function formatEndTime(targetEndTime: number): string {
  const date = new Date(targetEndTime)
  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')
  return `${hh}:${mm}`
}

export function CharacterPanel(): React.ReactNode {
  const currentMapId = useWorldStore((s) => s.currentMapId)
  const mapsLoaded = useWorldStore((s) => s.mapsLoaded)
  const serverCharacters = useWorldStore((s) => s.serverCharacters)
  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())

  const currentMap = mapsLoaded ? getMaps()[currentMapId] : null
  const serverChar = activeCharacter ? serverCharacters[activeCharacter.id] : null
  const currentAction = serverChar?.currentAction

  if (!activeCharacter) {
    return (
      <div className="bg-slate-800 border-l border-slate-700 p-3">
        <p className="text-slate-500 text-sm">キャラクター未選択</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 border-l border-slate-700 shrink-0">
      {/* キャラクター名 */}
      <div className="p-3 border-b border-slate-700">
        <p className="font-bold text-slate-100 text-lg">{activeCharacter.name}</p>
        <p className="text-slate-400 text-sm">
          📍 {currentMap?.name ?? currentMapId}
        </p>
      </div>

      {/* ステータスバー */}
      <div className="p-3 border-b border-slate-700 space-y-2">
        {Object.entries(STAT_LABELS).map(([key, { label, color }]) => (
          <CompactStatBar
            key={key}
            label={label}
            value={activeCharacter[key as keyof typeof activeCharacter] as number}
            color={color}
          />
        ))}
      </div>

      {/* 現在の行動 */}
      <div className="p-3">
        {currentAction ? (
          <div>
            <p className="text-slate-100 font-medium">
              {ACTION_LABELS[currentAction.actionId] || currentAction.actionId}
            </p>
            {currentAction.actionId !== 'talk' && (
              <p className="text-slate-400 text-sm">
                → {formatEndTime(currentAction.targetEndTime)}まで
              </p>
            )}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">待機中</p>
        )}
      </div>
    </div>
  )
}

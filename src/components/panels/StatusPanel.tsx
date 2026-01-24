'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useWorldStore, useCharacterStore } from '@/stores'
import { getMaps } from '@/data/maps'
import type { ActionId } from '@/types/action'

// アクションIDから日本語ラベルへのマッピング
const ACTION_LABELS: Record<ActionId, string> = {
  eat: '食事中',
  sleep: '睡眠中',
  toilet: 'トイレ中',
  bathe: '入浴中',
  rest: '休憩中',
  talk: '会話中',
  work: '仕事中',
  thinking: '考え中',
}

function formatTime(hour: number, minute: number, second?: number): string {
  const hh = hour.toString().padStart(2, '0')
  const mm = minute.toString().padStart(2, '0')
  if (second === undefined) {
    return `${hh}:${mm}`
  }
  const ss = second.toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatEndTime(targetEndTime: number): string {
  const date = new Date(targetEndTime)
  return formatTime(date.getHours(), date.getMinutes(), date.getSeconds())
}

interface StatBarProps {
  label: string
  value: number
}

function StatBar({ label, value }: StatBarProps): React.ReactNode {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span>{value.toFixed(2)}%</span>
      </div>
      <Progress value={value} className="h-2" />
    </div>
  )
}

export function StatusPanel(): React.ReactNode {
  const time = useWorldStore((s) => s.time)
  const currentMapId = useWorldStore((s) => s.currentMapId)
  const mapsLoaded = useWorldStore((s) => s.mapsLoaded)
  const serverCharacters = useWorldStore((s) => s.serverCharacters)
  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())

  const currentMap = mapsLoaded ? getMaps()[currentMapId] : null
  const serverChar = activeCharacter ? serverCharacters[activeCharacter.id] : null
  const currentAction = serverChar?.currentAction
  const conversation = serverChar?.conversation

  return (
    <div className="w-80 space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">キャラクター</CardTitle>
        </CardHeader>
        <CardContent>
          {activeCharacter ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-lg">
                  {activeCharacter.name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold">{activeCharacter.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {currentMap?.name ?? currentMapId}
                  </p>
                </div>
              </div>

              <StatBar label="満腹度" value={activeCharacter.satiety} />
              <StatBar label="体力" value={activeCharacter.energy} />
              <StatBar label="清潔度" value={activeCharacter.hygiene} />
              <StatBar label="気分" value={activeCharacter.mood} />
              <StatBar label="トイレ" value={activeCharacter.bladder} />

              <div className="flex justify-between items-center">
                <span className="text-sm">所持金</span>
                <span className="font-semibold text-green-600">
                  ¥{activeCharacter.money}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">キャラクター未選択</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">時刻</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center">
            <p className="text-3xl font-mono font-bold">
              {formatTime(time.hour, time.minute)}
            </p>
            <p className="text-sm text-muted-foreground">{time.day}日目</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">場所</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">マップ</span>
              <span className="font-medium">{currentMap?.name ?? currentMapId}</span>
            </div>
            {activeCharacter && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">ノード</span>
                <span className="font-medium text-xs">
                  {activeCharacter.currentNodeId}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">現在の行動</CardTitle>
        </CardHeader>
        <CardContent>
          {currentAction ? (
            <div className="space-y-2">
              <p className="font-medium text-lg">
                {ACTION_LABELS[currentAction.actionId] || currentAction.actionId}
              </p>
              {currentAction.actionId !== 'talk' && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">終了時刻</span>
                  <span className="font-mono">
                    {formatEndTime(currentAction.targetEndTime)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">行動なし</p>
          )}
        </CardContent>
      </Card>

      {conversation && conversation.status === 'active' && conversation.messages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">会話</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {conversation.messages.map((msg, i) => (
                <div key={i} className="text-sm">
                  <span className="font-semibold">
                    {msg.speakerName}:
                  </span>{' '}
                  <span className="text-muted-foreground">
                    {msg.utterance}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

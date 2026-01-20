'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useWorldStore, useCharacterStore } from '@/stores'
import { getMaps } from '@/data/maps'

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
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
        <span>{value}%</span>
      </div>
      <Progress value={value} className="h-2" />
    </div>
  )
}

export function StatusPanel(): React.ReactNode {
  const time = useWorldStore((s) => s.time)
  const currentMapId = useWorldStore((s) => s.currentMapId)
  const mapsLoaded = useWorldStore((s) => s.mapsLoaded)
  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())

  const currentMap = mapsLoaded ? getMaps()[currentMapId] : null

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
          <CardTitle className="text-lg">凡例</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>キャラクターは自動で行動します</p>
            <p>赤ノード = 入口（マップ遷移）</p>
            <p>緑ノード = スポーン地点</p>
            <p>青ノード = 通路</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

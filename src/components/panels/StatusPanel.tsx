'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useGameStore, useCharacterStore } from '@/stores'
import { maps } from '@/data/maps'

export function StatusPanel() {
  const time = useGameStore((s) => s.time)
  const currentMapId = useGameStore((s) => s.currentMapId)
  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())

  const currentMap = maps[currentMapId]

  const formatTime = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
  }

  return (
    <div className="w-80 space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Character</CardTitle>
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

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Hunger</span>
                  <span>{activeCharacter.hunger}%</span>
                </div>
                <Progress value={activeCharacter.hunger} className="h-2" />
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm">Money</span>
                <span className="font-semibold text-green-600">
                  ${activeCharacter.money}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No character selected</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center">
            <p className="text-3xl font-mono font-bold">
              {formatTime(time.hour, time.minute)}
            </p>
            <p className="text-sm text-muted-foreground">Day {time.day}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Location</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Map</span>
              <span className="font-medium">{currentMap?.name ?? currentMapId}</span>
            </div>
            {activeCharacter && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Node</span>
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
          <CardTitle className="text-lg">Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Character moves automatically</p>
            <p>Red nodes = entrances (map transition)</p>
            <p>Green nodes = spawn points</p>
            <p>Blue nodes = waypoints</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

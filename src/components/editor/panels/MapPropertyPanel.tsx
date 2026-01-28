'use client'

import { useEditorStore, selectCurrentMap } from '@/stores/editorStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function MapPropertyPanel(): React.ReactNode {
  const currentMap = useEditorStore(selectCurrentMap)
  const updateMap = useEditorStore((s) => s.updateMap)

  if (!currentMap) return null

  const handleChange = (field: string, value: string | number) => {
    updateMap(currentMap.id, { [field]: value })
  }

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="mapId" className="text-gray-300">
            マップID
          </Label>
          <Input
            id="mapId"
            value={currentMap.id}
            disabled
            className="mt-1 bg-gray-700 border-gray-600 text-gray-400"
          />
        </div>

        <div>
          <Label htmlFor="mapName" className="text-gray-300">
            マップ名
          </Label>
          <Input
            id="mapName"
            value={currentMap.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>
      </div>

      {/* Size */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">サイズ</h4>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="width" className="text-gray-300 text-xs">
              幅 (px)
            </Label>
            <Input
              id="width"
              type="number"
              value={currentMap.width}
              onChange={(e) => handleChange('width', parseInt(e.target.value) || 800)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label htmlFor="height" className="text-gray-300 text-xs">
              高さ (px)
            </Label>
            <Input
              id="height"
              type="number"
              value={currentMap.height}
              onChange={(e) => handleChange('height', parseInt(e.target.value) || 600)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">グリッド</h4>

        <div>
          <Label htmlFor="gridPrefix" className="text-gray-300 text-xs">
            ノードID接頭辞
          </Label>
          <Input
            id="gridPrefix"
            value={currentMap.grid.prefix}
            onChange={(e) =>
              updateMap(currentMap.id, {
                grid: { ...currentMap.grid, prefix: e.target.value },
              })
            }
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="gridCols" className="text-gray-300 text-xs">
              列数
            </Label>
            <Input
              id="gridCols"
              type="number"
              value={currentMap.grid.cols ?? 12}
              onChange={(e) =>
                updateMap(currentMap.id, {
                  grid: { ...currentMap.grid, cols: parseInt(e.target.value) || 12 },
                })
              }
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label htmlFor="gridRows" className="text-gray-300 text-xs">
              行数
            </Label>
            <Input
              id="gridRows"
              type="number"
              value={currentMap.grid.rows ?? 9}
              onChange={(e) =>
                updateMap(currentMap.id, {
                  grid: { ...currentMap.grid, rows: parseInt(e.target.value) || 9 },
                })
              }
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
        </div>
      </div>

      {/* Spawn Node */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">スポーン設定</h4>

        <div>
          <Label htmlFor="spawnNodeId" className="text-gray-300 text-xs">
            スポーンノードID
          </Label>
          <Input
            id="spawnNodeId"
            value={currentMap.spawnNodeId}
            onChange={(e) => handleChange('spawnNodeId', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>
      </div>

      {/* Background Color */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">背景色</h4>

        <div>
          <Label htmlFor="backgroundColor" className="text-gray-300 text-xs">
            16進数 (0xRRGGBB)
          </Label>
          <Input
            id="backgroundColor"
            value={currentMap.backgroundColor}
            onChange={(e) => handleChange('backgroundColor', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="pt-4 border-t border-gray-700">
        <h4 className="text-sm font-medium text-gray-400 mb-2">統計</h4>
        <div className="text-xs text-gray-500 space-y-1">
          <div>障害物: {currentMap.obstacles?.length ?? 0}</div>
          <div>入口: {currentMap.entrances.length}</div>
          <div>NPC: {currentMap.npcs?.length ?? 0}</div>
          <div>ラベル: {currentMap.labels?.length ?? 0}</div>
        </div>
      </div>
    </div>
  )
}

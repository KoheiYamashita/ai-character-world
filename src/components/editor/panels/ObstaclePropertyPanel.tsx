'use client'

import { useEditorStore, selectCurrentMap, selectCurrentObstacles } from '@/stores/editorStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import FacilityEditor from './FacilityEditor'
import WallSidesEditor from './WallSidesEditor'
import DoorEditor from './DoorEditor'
import type { ObstacleType, WallSide, DoorConfig, FacilityInfo } from '@/types/map'

interface ObstaclePropertyPanelProps {
  index: number
}

export default function ObstaclePropertyPanel({ index }: ObstaclePropertyPanelProps): React.ReactNode {
  const currentMap = useEditorStore(selectCurrentMap)
  const obstacles = useEditorStore(selectCurrentObstacles)
  const updateObstacle = useEditorStore((s) => s.updateObstacle)
  const deleteObstacle = useEditorStore((s) => s.deleteObstacle)
  const clearSelection = useEditorStore((s) => s.clearSelection)

  const obstacle = obstacles[index]
  if (!obstacle || !currentMap) return null

  const type = obstacle.type ?? 'building'

  const handleChange = (field: string, value: unknown) => {
    updateObstacle(currentMap.id, index, { [field]: value })
  }

  const handleDelete = () => {
    deleteObstacle(currentMap.id, index)
    clearSelection()
  }

  const handleFacilityChange = (facility: FacilityInfo | undefined) => {
    handleChange('facility', facility)
  }

  const handleWallSidesChange = (wallSides: WallSide[]) => {
    handleChange('wallSides', wallSides)
  }

  const handleDoorChange = (door: DoorConfig | undefined) => {
    handleChange('door', door)
  }

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="obsLabel" className="text-gray-300">
            ラベル
          </Label>
          <Input
            id="obsLabel"
            value={obstacle.label ?? ''}
            onChange={(e) => handleChange('label', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>

        <div>
          <Label htmlFor="obsType" className="text-gray-300">
            タイプ
          </Label>
          <Select
            value={type}
            onValueChange={(value) => handleChange('type', value as ObstacleType)}
          >
            <SelectTrigger className="mt-1 bg-gray-700 border-gray-600 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="building">Building（通過不可）</SelectItem>
              <SelectItem value="zone">Zone（壁付き領域）</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Position */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">位置</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="obsRow" className="text-gray-300 text-xs">
              行 (row)
            </Label>
            <Input
              id="obsRow"
              type="number"
              value={obstacle.row}
              onChange={(e) => handleChange('row', parseInt(e.target.value) || 0)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label htmlFor="obsCol" className="text-gray-300 text-xs">
              列 (col)
            </Label>
            <Input
              id="obsCol"
              type="number"
              value={obstacle.col}
              onChange={(e) => handleChange('col', parseInt(e.target.value) || 0)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
        </div>
      </div>

      {/* Size */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">サイズ</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="obsWidth" className="text-gray-300 text-xs">
              幅 (tiles)
            </Label>
            <Input
              id="obsWidth"
              type="number"
              min={type === 'zone' ? 4 : 2}
              value={obstacle.tileWidth}
              onChange={(e) => handleChange('tileWidth', parseInt(e.target.value) || 2)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label htmlFor="obsHeight" className="text-gray-300 text-xs">
              高さ (tiles)
            </Label>
            <Input
              id="obsHeight"
              type="number"
              min={type === 'zone' ? 4 : 2}
              value={obstacle.tileHeight}
              onChange={(e) => handleChange('tileHeight', parseInt(e.target.value) || 2)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          最小サイズ: {type === 'zone' ? '4x4' : '2x2'}
        </p>
      </div>

      {/* Zone-specific: Wall Sides */}
      {type === 'zone' && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-400">壁設定</h4>
          <WallSidesEditor
            wallSides={obstacle.wallSides ?? []}
            onChange={handleWallSidesChange}
          />
        </div>
      )}

      {/* Zone-specific: Door */}
      {type === 'zone' && obstacle.wallSides && obstacle.wallSides.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-400">ドア設定</h4>
          <DoorEditor
            door={obstacle.door}
            wallSides={obstacle.wallSides}
            tileWidth={obstacle.tileWidth}
            tileHeight={obstacle.tileHeight}
            onChange={handleDoorChange}
          />
        </div>
      )}

      {/* Facility */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-400">施設設定</h4>
          {!obstacle.facility && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFacilityChange({ actionIds: [] })}
            >
              + 追加
            </Button>
          )}
        </div>

        {obstacle.facility && (
          <FacilityEditor
            facility={obstacle.facility}
            onChange={handleFacilityChange}
            onRemove={() => handleFacilityChange(undefined)}
          />
        )}
      </div>

      {/* Delete Button */}
      <div className="pt-4 border-t border-gray-700">
        <Button variant="destructive" size="sm" className="w-full" onClick={handleDelete}>
          障害物を削除
        </Button>
      </div>
    </div>
  )
}

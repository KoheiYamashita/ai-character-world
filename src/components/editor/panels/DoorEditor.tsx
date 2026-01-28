'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DoorConfig, WallSide } from '@/types/map'

interface DoorEditorProps {
  door: DoorConfig | undefined
  wallSides: WallSide[]
  tileWidth: number
  tileHeight: number
  onChange: (door: DoorConfig | undefined) => void
}

const SIDE_LABELS: Record<WallSide, string> = {
  top: '上辺',
  bottom: '下辺',
  left: '左辺',
  right: '右辺',
}

export default function DoorEditor({
  door,
  wallSides,
  tileWidth,
  tileHeight,
  onChange,
}: DoorEditorProps): React.ReactNode {
  if (wallSides.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        壁を選択するとドアを設定できます
      </p>
    )
  }

  const handleAdd = () => {
    const defaultSide = wallSides[0]
    const wallLength = defaultSide === 'top' || defaultSide === 'bottom' ? tileWidth : tileHeight
    onChange({
      side: defaultSide,
      start: 1,
      end: Math.min(3, wallLength - 1),
    })
  }

  const handleChange = (field: keyof DoorConfig, value: string | number) => {
    if (!door) return
    onChange({ ...door, [field]: value })
  }

  const handleRemove = () => {
    onChange(undefined)
  }

  if (!door) {
    return (
      <div className="space-y-2">
        <Button variant="outline" size="sm" onClick={handleAdd}>
          + ドアを追加
        </Button>
        <p className="text-xs text-gray-500">
          ドアを追加すると壁に開口部が作られます
        </p>
      </div>
    )
  }

  const wallLength = door.side === 'top' || door.side === 'bottom' ? tileWidth : tileHeight

  return (
    <div className="space-y-3 p-3 bg-gray-700 rounded">
      {/* Side selection */}
      <div>
        <Label className="text-gray-300 text-xs">配置する壁</Label>
        <Select
          value={door.side}
          onValueChange={(value) => handleChange('side', value as WallSide)}
        >
          <SelectTrigger className="mt-1 bg-gray-600 border-gray-500 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {wallSides.map((side) => (
              <SelectItem key={side} value={side}>
                {SIDE_LABELS[side]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Start/End position */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="doorStart" className="text-gray-300 text-xs">
            開始位置
          </Label>
          <Input
            id="doorStart"
            type="number"
            min={0}
            max={wallLength - 2}
            value={door.start}
            onChange={(e) => handleChange('start', parseInt(e.target.value) || 0)}
            className="mt-1 bg-gray-600 border-gray-500 text-white text-sm"
          />
        </div>
        <div>
          <Label htmlFor="doorEnd" className="text-gray-300 text-xs">
            終了位置
          </Label>
          <Input
            id="doorEnd"
            type="number"
            min={door.start + 2}
            max={wallLength}
            value={door.end}
            onChange={(e) => handleChange('end', parseInt(e.target.value) || door.start + 2)}
            className="mt-1 bg-gray-600 border-gray-500 text-white text-sm"
          />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        壁の長さ: {wallLength} タイル（開口部: {door.start} 〜 {door.end} の間）
      </p>

      <Button
        variant="outline"
        size="sm"
        className="w-full text-red-400 hover:text-red-300"
        onClick={handleRemove}
      >
        ドアを削除
      </Button>
    </div>
  )
}

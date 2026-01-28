'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { WallSide } from '@/types/map'

interface WallSidesEditorProps {
  wallSides: WallSide[]
  onChange: (wallSides: WallSide[]) => void
}

const WALL_SIDES: { side: WallSide; label: string }[] = [
  { side: 'top', label: '上' },
  { side: 'bottom', label: '下' },
  { side: 'left', label: '左' },
  { side: 'right', label: '右' },
]

export default function WallSidesEditor({
  wallSides,
  onChange,
}: WallSidesEditorProps): React.ReactNode {
  const handleToggle = (side: WallSide, checked: boolean) => {
    const newSides = checked
      ? [...wallSides, side]
      : wallSides.filter((s) => s !== side)
    onChange(newSides)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {WALL_SIDES.map(({ side, label }) => (
          <div key={side} className="flex items-center gap-2">
            <Checkbox
              id={`wall-${side}`}
              checked={wallSides.includes(side)}
              onCheckedChange={(checked) => handleToggle(side, checked === true)}
            />
            <Label
              htmlFor={`wall-${side}`}
              className="text-sm text-gray-300 cursor-pointer"
            >
              {label}辺
            </Label>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        選択した辺に壁が描画されます
      </p>
    </div>
  )
}

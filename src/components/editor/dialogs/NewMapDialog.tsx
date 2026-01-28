'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useEditorStore } from '@/stores/editorStore'
import type { MapConfigJson } from '@/types/map'

interface NewMapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function NewMapDialog({ open, onOpenChange }: NewMapDialogProps): React.ReactNode {
  const addMap = useEditorStore((s) => s.addMap)

  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(600)
  const [cols, setCols] = useState(12)
  const [rows, setRows] = useState(9)

  const handleCreate = () => {
    if (!id.trim() || !name.trim()) return

    const newMap: MapConfigJson = {
      id: id.trim(),
      name: name.trim(),
      width,
      height,
      backgroundColor: '0x4a7c59',
      spawnNodeId: `${id}-4-4`,
      grid: {
        prefix: id,
        cols,
        rows,
      },
      labels: [],
      entrances: [],
      obstacles: [],
      npcs: [],
    }

    addMap(newMap)
    onOpenChange(false)

    // Reset form
    setId('')
    setName('')
    setWidth(800)
    setHeight(600)
    setCols(12)
    setRows(9)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>新規マップ作成</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="newMapId" className="text-gray-300">
              マップID
            </Label>
            <Input
              id="newMapId"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-new-map"
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newMapName" className="text-gray-300">
              マップ名
            </Label>
            <Input
              id="newMapName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="新しいマップ"
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="newMapWidth" className="text-gray-300">
                幅 (px)
              </Label>
              <Input
                id="newMapWidth"
                type="number"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 800)}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newMapHeight" className="text-gray-300">
                高さ (px)
              </Label>
              <Input
                id="newMapHeight"
                type="number"
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value) || 600)}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="newMapCols" className="text-gray-300">
                グリッド列数
              </Label>
              <Input
                id="newMapCols"
                type="number"
                value={cols}
                onChange={(e) => setCols(parseInt(e.target.value) || 12)}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newMapRows" className="text-gray-300">
                グリッド行数
              </Label>
              <Input
                id="newMapRows"
                type="number"
                value={rows}
                onChange={(e) => setRows(parseInt(e.target.value) || 9)}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleCreate} disabled={!id.trim() || !name.trim()}>
            作成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

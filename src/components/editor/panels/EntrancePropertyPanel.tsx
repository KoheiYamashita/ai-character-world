'use client'

import { useEditorStore, selectCurrentMap, selectCurrentEntrances } from '@/stores/editorStore'
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
import { Checkbox } from '@/components/ui/checkbox'

interface EntrancePropertyPanelProps {
  index: number
}

export default function EntrancePropertyPanel({ index }: EntrancePropertyPanelProps): React.ReactNode {
  const maps = useEditorStore((s) => s.maps)
  const currentMap = useEditorStore(selectCurrentMap)
  const entrances = useEditorStore(selectCurrentEntrances)
  const updateEntrance = useEditorStore((s) => s.updateEntrance)
  const deleteEntrance = useEditorStore((s) => s.deleteEntrance)
  const clearSelection = useEditorStore((s) => s.clearSelection)

  const entrance = entrances[index]
  if (!entrance || !currentMap) return null

  const handleChange = (field: string, value: unknown) => {
    updateEntrance(currentMap.id, index, { [field]: value })
  }

  const handleLeadsToChange = (field: 'mapId' | 'nodeId', value: string) => {
    updateEntrance(currentMap.id, index, {
      leadsTo: { ...entrance.leadsTo, [field]: value },
    })
  }

  const handleConnectedNodeToggle = (nodeId: string, checked: boolean) => {
    const newConnectedNodes = checked
      ? [...entrance.connectedNodeIds, nodeId]
      : entrance.connectedNodeIds.filter((id) => id !== nodeId)
    handleChange('connectedNodeIds', newConnectedNodes)
  }

  const handleDelete = () => {
    deleteEntrance(currentMap.id, index)
    clearSelection()
  }

  // Generate available node IDs for current map
  const gridCols = currentMap.grid.cols ?? 12
  const gridRows = currentMap.grid.rows ?? 9
  const prefix = currentMap.grid.prefix
  const availableNodes: string[] = []
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      availableNodes.push(`${prefix}-${row}-${col}`)
    }
  }

  // Get entrances from target map for leadsTo.nodeId selection
  const targetMap = maps.find((m) => m.id === entrance.leadsTo.mapId)
  const targetEntrances = targetMap?.entrances ?? []

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="entId" className="text-gray-300">
            入口ID
          </Label>
          <Input
            id="entId"
            value={entrance.id}
            onChange={(e) => handleChange('id', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>

        <div>
          <Label htmlFor="entLabel" className="text-gray-300">
            ラベル
          </Label>
          <Input
            id="entLabel"
            value={entrance.label}
            onChange={(e) => handleChange('label', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>
      </div>

      {/* Position */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">位置</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="entRow" className="text-gray-300 text-xs">
              行 (row)
            </Label>
            <Input
              id="entRow"
              type="number"
              value={entrance.row}
              onChange={(e) => handleChange('row', parseInt(e.target.value) || 0)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label htmlFor="entCol" className="text-gray-300 text-xs">
              列 (col)
            </Label>
            <Input
              id="entCol"
              type="number"
              value={entrance.col}
              onChange={(e) => handleChange('col', parseInt(e.target.value) || 0)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          -1 を指定するとグリッド範囲外（マップ端）に配置されます
        </p>
      </div>

      {/* Connected Nodes */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">接続ノード</h4>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {availableNodes.slice(0, 30).map((nodeId) => (
            <div key={nodeId} className="flex items-center gap-2">
              <Checkbox
                id={`conn-${nodeId}`}
                checked={entrance.connectedNodeIds.includes(nodeId)}
                onCheckedChange={(checked) =>
                  handleConnectedNodeToggle(nodeId, checked === true)
                }
              />
              <Label
                htmlFor={`conn-${nodeId}`}
                className="text-xs text-gray-300 cursor-pointer"
              >
                {nodeId}
              </Label>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          選択中: {entrance.connectedNodeIds.length} ノード
        </p>
      </div>

      {/* Leads To */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">接続先</h4>

        <div>
          <Label htmlFor="leadsToMap" className="text-gray-300 text-xs">
            マップID
          </Label>
          <Select
            value={entrance.leadsTo.mapId || '_none'}
            onValueChange={(value) => handleLeadsToChange('mapId', value === '_none' ? '' : value)}
          >
            <SelectTrigger className="mt-1 bg-gray-700 border-gray-600 text-white">
              <SelectValue placeholder="マップを選択" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">-- 未設定 --</SelectItem>
              {maps
                .filter((m) => m.id !== currentMap.id)
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {entrance.leadsTo.mapId && (
          <div>
            <Label htmlFor="leadsToNode" className="text-gray-300 text-xs">
              入口ID
            </Label>
            <Select
              value={entrance.leadsTo.nodeId || '_none'}
              onValueChange={(value) => handleLeadsToChange('nodeId', value === '_none' ? '' : value)}
            >
              <SelectTrigger className="mt-1 bg-gray-700 border-gray-600 text-white">
                <SelectValue placeholder="入口を選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">-- 未設定 --</SelectItem>
                {targetEntrances.map((ent) => (
                  <SelectItem key={ent.id} value={ent.id}>
                    {ent.label} ({ent.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Delete Button */}
      <div className="pt-4 border-t border-gray-700">
        <Button variant="destructive" size="sm" className="w-full" onClick={handleDelete}>
          入口を削除
        </Button>
      </div>
    </div>
  )
}

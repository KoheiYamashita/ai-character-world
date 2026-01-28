'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { FacilityInfo } from '@/types/map'
import type { ActionId } from '@/types/action'
import { ACTION_INFO, getActionLabel } from '@/lib/uiLabels'

interface FacilityEditorProps {
  facility: FacilityInfo
  onChange: (facility: FacilityInfo) => void
  onRemove: () => void
}

// Get all available action IDs from ACTION_INFO
const ALL_ACTION_IDS = Object.keys(ACTION_INFO) as ActionId[]

export default function FacilityEditor({
  facility,
  onChange,
  onRemove,
}: FacilityEditorProps): React.ReactNode {
  const handleActionToggle = (actionId: ActionId, checked: boolean) => {
    const newActionIds = checked
      ? [...facility.actionIds, actionId]
      : facility.actionIds.filter((id) => id !== actionId)
    onChange({ ...facility, actionIds: newActionIds })
  }

  const handleFieldChange = (field: keyof FacilityInfo, value: unknown) => {
    if (value === '' || value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [field]: _, ...rest } = facility
      onChange(rest as FacilityInfo)
    } else {
      onChange({ ...facility, [field]: value })
    }
  }

  return (
    <div className="space-y-4 p-3 bg-gray-700 rounded">
      {/* Actions */}
      <div>
        <Label className="text-gray-300 text-xs">実行可能なアクション</Label>
        <div className="mt-2 grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
          {ALL_ACTION_IDS.map((actionId) => (
            <div key={actionId} className="flex items-center gap-2">
              <Checkbox
                id={`action-${actionId}`}
                checked={facility.actionIds.includes(actionId)}
                onCheckedChange={(checked) => handleActionToggle(actionId, checked === true)}
              />
              <Label
                htmlFor={`action-${actionId}`}
                className="text-xs text-gray-300 cursor-pointer"
              >
                {getActionLabel(actionId)} ({actionId})
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Actions Display */}
      {facility.actionIds.length > 0 && (
        <div>
          <Label className="text-gray-300 text-xs">選択済みアクション</Label>
          <div className="mt-1 flex flex-wrap gap-1">
            {facility.actionIds.map((actionId) => (
              <span
                key={actionId}
                className="px-2 py-0.5 bg-blue-900 text-blue-200 text-xs rounded"
              >
                {ACTION_INFO[actionId]?.emoji} {getActionLabel(actionId)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Optional fields */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="facilityOwner" className="text-gray-300 text-xs">
            オーナーID (任意)
          </Label>
          <Input
            id="facilityOwner"
            value={facility.owner ?? ''}
            onChange={(e) => handleFieldChange('owner', e.target.value || undefined)}
            placeholder="キャラクターID"
            className="mt-1 bg-gray-600 border-gray-500 text-white text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="facilityCost" className="text-gray-300 text-xs">
              利用料金
            </Label>
            <Input
              id="facilityCost"
              type="number"
              min={0}
              value={facility.cost ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value) : undefined
                handleFieldChange('cost', val)
              }}
              placeholder="0"
              className="mt-1 bg-gray-600 border-gray-500 text-white text-sm"
            />
          </div>
          <div>
            <Label htmlFor="facilityQuality" className="text-gray-300 text-xs">
              品質 (0-100)
            </Label>
            <Input
              id="facilityQuality"
              type="number"
              min={0}
              max={100}
              value={facility.quality ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value) : undefined
                handleFieldChange('quality', val)
              }}
              placeholder="50"
              className="mt-1 bg-gray-600 border-gray-500 text-white text-sm"
            />
          </div>
        </div>
      </div>

      {/* Remove button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full text-red-400 hover:text-red-300"
        onClick={onRemove}
      >
        施設設定を削除
      </Button>
    </div>
  )
}

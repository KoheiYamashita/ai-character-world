'use client'

import { useEditorStore, selectCurrentMap } from '@/stores/editorStore'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { EditorTool } from '@/types/editor'
import { cn } from '@/lib/utils'

interface EditorToolbarProps {
  onSave: () => void
  onValidate: () => void
  isSaving: boolean
}

interface ToolButtonProps {
  tool: EditorTool
  label: string
  icon: string
}

const TOOLS: ToolButtonProps[] = [
  { tool: 'select', label: '選択', icon: '↖' },
  { tool: 'building', label: '障害物', icon: '▣' },
  { tool: 'zone', label: 'ゾーン', icon: '▢' },
  { tool: 'entrance', label: '入口', icon: '◉' },
  { tool: 'npc', label: 'NPC', icon: '👤' },
  { tool: 'pan', label: 'パン', icon: '✋' },
]

export default function EditorToolbar({
  onSave,
  onValidate,
  isSaving,
}: EditorToolbarProps): React.ReactNode {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const isDirty = useEditorStore((s) => s.isDirty)
  const settings = useEditorStore((s) => s.settings)
  const updateSettings = useEditorStore((s) => s.updateSettings)
  const isValidating = useEditorStore((s) => s.isValidating)
  const currentMap = useEditorStore(selectCurrentMap)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.canUndo())
  const canRedo = useEditorStore((s) => s.canRedo())

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-gray-800 border-b border-gray-700">
      {/* Tool buttons */}
      <div className="flex items-center gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            onClick={() => setTool(t.tool)}
            title={t.label}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded text-lg transition-colors',
              tool === t.tool
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            )}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-gray-600" />

      {/* Undo/Redo buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={undo}
          disabled={!canUndo}
          title="戻る (Ctrl+Z)"
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded text-lg transition-colors',
            canUndo
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'
          )}
        >
          ←
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="進む (Ctrl+Y)"
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded text-lg transition-colors',
            canRedo
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'
          )}
        >
          →
        </button>
      </div>

      <div className="h-6 w-px bg-gray-600" />

      {/* View settings */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="gridVisible"
            checked={settings.gridVisible}
            onCheckedChange={(checked) =>
              updateSettings({ gridVisible: checked === true })
            }
          />
          <Label htmlFor="gridVisible" className="text-sm text-gray-300 cursor-pointer">
            グリッド
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="snapToGrid"
            checked={settings.snapToGrid}
            onCheckedChange={(checked) =>
              updateSettings({ snapToGrid: checked === true })
            }
          />
          <Label htmlFor="snapToGrid" className="text-sm text-gray-300 cursor-pointer">
            スナップ
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="showFacilityTags"
            checked={settings.showFacilityTags}
            onCheckedChange={(checked) =>
              updateSettings({ showFacilityTags: checked === true })
            }
          />
          <Label htmlFor="showFacilityTags" className="text-sm text-gray-300 cursor-pointer">
            施設タグ
          </Label>
        </div>
      </div>

      <div className="flex-1" />

      {/* Current map info */}
      {currentMap && (
        <div className="text-sm text-gray-400">
          {currentMap.name} ({currentMap.width}x{currentMap.height})
        </div>
      )}

      <div className="h-6 w-px bg-gray-600" />

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          onClick={onValidate}
          variant="outline"
          size="sm"
          disabled={isValidating}
        >
          {isValidating ? '検証中...' : '検証'}
        </Button>

        <Button
          onClick={onSave}
          variant={isDirty ? 'default' : 'outline'}
          size="sm"
          disabled={!isDirty || isSaving}
        >
          {isSaving ? '保存中...' : isDirty ? '保存 *' : '保存'}
        </Button>
      </div>
    </div>
  )
}

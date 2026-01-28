'use client'

import { useEditorStore, selectCurrentMap } from '@/stores/editorStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import MapPropertyPanel from './panels/MapPropertyPanel'
import ObstaclePropertyPanel from './panels/ObstaclePropertyPanel'
import EntrancePropertyPanel from './panels/EntrancePropertyPanel'
import NPCPropertyPanel from './panels/NPCPropertyPanel'

export default function PropertyPanel(): React.ReactNode {
  const selection = useEditorStore((s) => s.selection)
  const currentMap = useEditorStore(selectCurrentMap)

  if (!currentMap) {
    return (
      <div className="h-full bg-gray-800 p-4 text-gray-500 text-center">
        マップを選択してください
      </div>
    )
  }

  // Render appropriate panel based on selection
  const renderPanel = () => {
    if (!selection) {
      return <MapPropertyPanel />
    }

    switch (selection.type) {
      case 'obstacle':
        return selection.index !== undefined ? (
          <ObstaclePropertyPanel index={selection.index} />
        ) : (
          <MapPropertyPanel />
        )
      case 'entrance':
        return selection.index !== undefined ? (
          <EntrancePropertyPanel index={selection.index} />
        ) : (
          <MapPropertyPanel />
        )
      case 'npc':
        return selection.index !== undefined ? (
          <NPCPropertyPanel index={selection.index} />
        ) : (
          <MapPropertyPanel />
        )
      default:
        return <MapPropertyPanel />
    }
  }

  return (
    <div className="h-full bg-gray-800 flex flex-col">
      <div className="p-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-200">
          {!selection && 'マップ設定'}
          {selection?.type === 'obstacle' && '障害物プロパティ'}
          {selection?.type === 'entrance' && '入口プロパティ'}
          {selection?.type === 'npc' && 'NPCプロパティ'}
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3">{renderPanel()}</div>
      </ScrollArea>
    </div>
  )
}

'use client'

import { useEditorStore } from '@/stores/editorStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface MapSelectorPanelProps {
  onNewMap: () => void
}

export default function MapSelectorPanel({ onNewMap }: MapSelectorPanelProps): React.ReactNode {
  const maps = useEditorStore((s) => s.maps)
  const currentMapId = useEditorStore((s) => s.currentMapId)
  const setCurrentMap = useEditorStore((s) => s.setCurrentMap)

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-200">マップ一覧</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {maps.map((map) => (
            <button
              key={map.id}
              onClick={() => setCurrentMap(map.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded text-sm transition-colors',
                currentMapId === map.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
              )}
            >
              <div className="font-medium truncate">{map.name}</div>
              <div className="text-xs opacity-70">{map.id}</div>
            </button>
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-gray-700">
        <Button onClick={onNewMap} variant="outline" size="sm" className="w-full">
          + 新規マップ
        </Button>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useEditorStore, selectCurrentMap, selectCurrentNPCs } from '@/stores/editorStore'
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

interface SpriteInfo {
  name: string
  path: string
  category: string
}

interface SpritesResponse {
  success: boolean
  sprites: {
    characters: SpriteInfo[]
    npcs: SpriteInfo[]
  }
}

interface NPCPropertyPanelProps {
  index: number
}

export default function NPCPropertyPanel({ index }: NPCPropertyPanelProps): React.ReactNode {
  const currentMap = useEditorStore(selectCurrentMap)
  const npcs = useEditorStore(selectCurrentNPCs)
  const updateNPC = useEditorStore((s) => s.updateNPC)
  const deleteNPC = useEditorStore((s) => s.deleteNPC)
  const clearSelection = useEditorStore((s) => s.clearSelection)

  const [sprites, setSprites] = useState<SpriteInfo[]>([])
  const [isLoadingSprites, setIsLoadingSprites] = useState(false)

  // スプライト一覧を取得
  useEffect(() => {
    const fetchSprites = async () => {
      setIsLoadingSprites(true)
      try {
        const response = await fetch('/api/sprites')
        if (response.ok) {
          const data = (await response.json()) as SpritesResponse
          // charactersとnpcsを結合
          const allSprites = [...data.sprites.characters, ...data.sprites.npcs]
          setSprites(allSprites)
        }
      } catch (error) {
        console.error('Failed to fetch sprites:', error)
      } finally {
        setIsLoadingSprites(false)
      }
    }

    fetchSprites()
  }, [])

  const npc = npcs[index]
  if (!npc || !currentMap) return null

  const handleChange = (field: string, value: unknown) => {
    updateNPC(currentMap.id, index, { [field]: value })
  }

  const handleArrayChange = (field: string, value: string) => {
    const items = value
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    handleChange(field, items)
  }

  const handleDelete = () => {
    deleteNPC(currentMap.id, index)
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

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="npcId" className="text-gray-300">
            NPC ID
          </Label>
          <Input
            id="npcId"
            value={npc.id}
            onChange={(e) => handleChange('id', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>

        <div>
          <Label htmlFor="npcName" className="text-gray-300">
            名前
          </Label>
          <Input
            id="npcName"
            value={npc.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="mt-1 bg-gray-700 border-gray-600 text-white"
          />
        </div>
      </div>

      {/* Spawn Node */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">配置</h4>
        <div>
          <Label htmlFor="spawnNodeId" className="text-gray-300 text-xs">
            スポーンノード
          </Label>
          <Select
            value={npc.spawnNodeId}
            onValueChange={(value) => handleChange('spawnNodeId', value)}
          >
            <SelectTrigger className="mt-1 bg-gray-700 border-gray-600 text-white">
              <SelectValue placeholder="ノードを選択" />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {availableNodes.map((nodeId) => (
                <SelectItem key={nodeId} value={nodeId}>
                  {nodeId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Personality */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">性格設定</h4>

        <div>
          <Label htmlFor="personality" className="text-gray-300 text-xs">
            性格描写
          </Label>
          <textarea
            id="personality"
            value={npc.personality}
            onChange={(e) => handleChange('personality', e.target.value)}
            className="mt-1 w-full h-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm resize-none"
            placeholder="明るく社交的で..."
          />
        </div>

        <div>
          <Label htmlFor="tendencies" className="text-gray-300 text-xs">
            行動傾向（1行1項目）
          </Label>
          <textarea
            id="tendencies"
            value={npc.tendencies.join('\n')}
            onChange={(e) => handleArrayChange('tendencies', e.target.value)}
            className="mt-1 w-full h-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm resize-none"
            placeholder="新しい情報をすぐに共有したがる&#10;相手の話をよく聞く"
          />
        </div>

        <div>
          <Label htmlFor="facts" className="text-gray-300 text-xs">
            事実情報（1行1項目）
          </Label>
          <textarea
            id="facts"
            value={npc.facts.join('\n')}
            onChange={(e) => handleArrayChange('facts', e.target.value)}
            className="mt-1 w-full h-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm resize-none"
            placeholder="町の情報通&#10;花屋でパートをしている"
          />
        </div>
      </div>

      {/* Sprite */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-400">スプライト</h4>
        <div>
          <Label htmlFor="spriteUrl" className="text-gray-300 text-xs">
            スプライトシート
          </Label>
          <Select
            value={npc.sprite.sheetUrl}
            onValueChange={(value) =>
              handleChange('sprite', { ...npc.sprite, sheetUrl: value })
            }
          >
            <SelectTrigger className="mt-1 bg-gray-700 border-gray-600 text-white">
              <SelectValue placeholder={isLoadingSprites ? '読み込み中...' : 'スプライトを選択'} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {sprites.map((sprite) => (
                <SelectItem key={sprite.path} value={sprite.path}>
                  <span className="text-xs text-gray-400">[{sprite.category}]</span>{' '}
                  {sprite.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* スプライトプレビュー */}
        {npc.sprite.sheetUrl && (
          <div className="mt-2">
            <Label className="text-gray-300 text-xs">プレビュー</Label>
            <div className="mt-1 p-2 bg-gray-700 rounded flex items-center justify-center">
              <div
                className="w-24 h-24 bg-contain bg-no-repeat bg-center"
                style={{
                  backgroundImage: `url(${npc.sprite.sheetUrl})`,
                  backgroundPosition: '0 0',
                  backgroundSize: `${npc.sprite.cols * 100}% ${npc.sprite.rows * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* 手動入力 */}
        <div>
          <Label htmlFor="spriteUrlManual" className="text-gray-300 text-xs">
            URL直接入力
          </Label>
          <Input
            id="spriteUrlManual"
            value={npc.sprite.sheetUrl}
            onChange={(e) =>
              handleChange('sprite', { ...npc.sprite, sheetUrl: e.target.value })
            }
            className="mt-1 bg-gray-700 border-gray-600 text-white text-xs"
            placeholder="/assets/sprites/..."
          />
        </div>
      </div>

      {/* Delete Button */}
      <div className="pt-4 border-t border-gray-700">
        <Button variant="destructive" size="sm" className="w-full" onClick={handleDelete}>
          NPCを削除
        </Button>
      </div>
    </div>
  )
}

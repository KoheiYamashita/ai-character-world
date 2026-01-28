'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorKeyboard } from '@/hooks/useEditorKeyboard'
import EditorToolbar from '@/components/editor/EditorToolbar'
import PropertyPanel from '@/components/editor/PropertyPanel'
import MapSelectorPanel from '@/components/editor/panels/MapSelectorPanel'
import NewMapDialog from '@/components/editor/dialogs/NewMapDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { MapsDataJson, ValidationResult } from '@/types'

// Dynamic import for EditorCanvas to avoid SSR issues with PixiJS
const EditorCanvas = dynamic(
  () => import('@/components/editor/EditorCanvas'),
  { ssr: false, loading: () => <div className="flex-1 bg-gray-900 animate-pulse" /> }
)

export default function EditorPage(): React.ReactNode {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNewMapDialog, setShowNewMapDialog] = useState(false)

  const setMaps = useEditorStore((s) => s.setMaps)
  const maps = useEditorStore((s) => s.maps)
  const markClean = useEditorStore((s) => s.markClean)
  const validationResult = useEditorStore((s) => s.validationResult)
  const setValidationResult = useEditorStore((s) => s.setValidationResult)
  const setIsValidating = useEditorStore((s) => s.setIsValidating)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)

  // Load maps on mount
  useEffect(() => {
    const loadMaps = async () => {
      try {
        const response = await fetch('/api/maps')
        if (!response.ok) throw new Error('Failed to load maps')
        const data = (await response.json()) as MapsDataJson
        setMaps(data.maps)
        setIsLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setIsLoading(false)
      }
    }

    loadMaps()
  }, [setMaps])

  // Save handler
  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/maps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maps }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to save')
      }

      markClean()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }, [maps, markClean])

  // Validate handler
  const handleValidate = useCallback(async () => {
    setIsValidating(true)
    setError(null)

    try {
      const response = await fetch('/api/maps/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maps }),
      })

      if (!response.ok) {
        throw new Error('Validation request failed')
      }

      const result = (await response.json()) as ValidationResult
      setValidationResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setIsValidating(false)
    }
  }, [maps, setValidationResult, setIsValidating])

  // Keyboard shortcuts
  useEditorKeyboard({ onSave: handleSave, onUndo: undo, onRedo: redo })

  if (isLoading) {
    return (
      <div className="dark flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-lg">マップデータを読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="dark flex flex-col h-screen bg-gray-900 text-white">
      {/* Toolbar */}
      <EditorToolbar onSave={handleSave} onValidate={handleValidate} isSaving={isSaving} />

      {/* Error / Validation alerts */}
      {error && (
        <Alert variant="destructive" className="mx-4 mt-2">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {validationResult && !validationResult.valid && (
        <Alert variant="destructive" className="mx-4 mt-2">
          <AlertTitle>バリデーションエラー</AlertTitle>
          <AlertDescription>
            <div className="max-h-32 overflow-y-auto">
              {validationResult.results
                .filter((r) => !r.valid)
                .map((r) => (
                  <div key={r.mapId} className="mb-2">
                    <strong>{r.mapName} ({r.mapId}):</strong>
                    <ul className="list-disc list-inside ml-2">
                      {r.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {validationResult && validationResult.valid && (
        <Alert className="mx-4 mt-2 bg-green-900 border-green-700">
          <AlertTitle>検証成功</AlertTitle>
          <AlertDescription>すべてのマップが正常です</AlertDescription>
        </Alert>
      )}

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Map selector */}
        <div className="w-48 border-r border-gray-700 bg-gray-800">
          <MapSelectorPanel onNewMap={() => setShowNewMapDialog(true)} />
        </div>

        {/* Center - Canvas */}
        <div className="flex-1 overflow-hidden">
          <EditorCanvas />
        </div>

        {/* Right sidebar - Property panel */}
        <div className="w-72 border-l border-gray-700">
          <PropertyPanel />
        </div>
      </div>

      {/* Dialogs */}
      <NewMapDialog open={showNewMapDialog} onOpenChange={setShowNewMapDialog} />
    </div>
  )
}

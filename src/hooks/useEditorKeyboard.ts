/**
 * エディタ用キーボードショートカットフック
 */

import { useEffect, useCallback } from 'react'
import { useEditorStore } from '@/stores/editorStore'

interface UseEditorKeyboardOptions {
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export function useEditorKeyboard({ onSave, onUndo, onRedo }: UseEditorKeyboardOptions = {}): void {
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const clearSelection = useEditorStore((s) => s.clearSelection)
  const selection = useEditorStore((s) => s.selection)
  const setTool = useEditorStore((s) => s.setTool)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Ctrl/Cmd + S: Save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        onSave?.()
        return
      }

      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y: Redo
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        onRedo?.()
        return
      }

      // Ctrl/Cmd + Z: Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        onUndo?.()
        return
      }

      // Delete/Backspace: Delete selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        deleteSelected()
        return
      }

      // Escape: Clear selection
      if (e.key === 'Escape') {
        e.preventDefault()
        clearSelection()
        return
      }

      // Tool shortcuts
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
            e.preventDefault()
            setTool('select')
            break
          case 'b':
            e.preventDefault()
            setTool('building')
            break
          case 'z':
            e.preventDefault()
            setTool('zone')
            break
          case 'e':
            e.preventDefault()
            setTool('entrance')
            break
          case 'n':
            e.preventDefault()
            setTool('npc')
            break
          case 'h':
          case 'p':
            e.preventDefault()
            setTool('pan')
            break
        }
      }
    },
    [selection, deleteSelected, clearSelection, setTool, onSave, onUndo, onRedo]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

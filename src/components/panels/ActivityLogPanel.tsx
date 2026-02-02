'use client'

import { useEffect, useRef, useState } from 'react'
import { useActivityLogStore } from '@/stores'
import type { ActivityLogEntry, ActionLogEntry, ConversationLogEntry, ConversationMessageLogEntry, MiniEpisodeLogEntry, DebugLLMBehaviorLogEntry, DebugConversationTurnLogEntry } from '@/types'
import { getActionLabel } from '@/lib/uiLabels'

function ActionLogLine({ entry }: { entry: ActionLogEntry }) {
  const isStarted = entry.status === 'started'
  const actionLabel = getActionLabel(entry.actionId)

  if (isStarted) {
    // 開始表示: [10:00] 花子 - ▶ 食事開始 @ レストラン (予定30分): お腹が空いたから
    return (
      <div className="text-sm text-slate-300 py-0.5">
        <span className="text-slate-500">[{entry.time}]</span>{' '}
        <span className="text-blue-300 font-medium">{entry.characterName}</span>{' '}
        <span className="text-green-400">▶</span>{' '}
        <span className="text-slate-400">{actionLabel}開始</span>
        {entry.target && <span className="text-slate-500"> @ {entry.target}</span>}
        {entry.durationMinutes !== undefined && (
          <span className="text-slate-500"> (予定{entry.durationMinutes}分)</span>
        )}
        {entry.reason && <span className="text-slate-500">: {entry.reason}</span>}
      </div>
    )
  }

  // 完了表示（デフォルト）: [10:30] 花子 - ✓ 食事完了 @ レストラン (30分)
  return (
    <div className="text-sm text-slate-300 py-0.5">
      <span className="text-slate-500">[{entry.time}]</span>{' '}
      <span className="text-blue-300 font-medium">{entry.characterName}</span>{' '}
      <span className="text-slate-400">✓</span>{' '}
      <span className="text-slate-400">{actionLabel}完了</span>
      {entry.target && <span className="text-slate-500"> @ {entry.target}</span>}
      {entry.durationMinutes !== undefined && (
        <span className="text-slate-500"> ({entry.durationMinutes}分)</span>
      )}
    </div>
  )
}

function ConversationLogLine({ entry }: { entry: ConversationLogEntry }) {
  return (
    <div className="text-sm text-slate-300 py-0.5">
      <span className="text-slate-500">[{entry.time}]</span>{' '}
      <span className="text-blue-300 font-medium">{entry.characterName}</span>
      <span className="text-slate-400"> → </span>
      <span className="text-green-300">{entry.npcName}</span>
      <span className="text-slate-400"> 会話: </span>
      <span className="text-slate-200">{entry.summary}</span>
      {entry.topics.length > 0 && (
        <span className="text-slate-500"> [{entry.topics.join(', ')}]</span>
      )}
      {entry.affinityChange !== undefined && entry.affinityChange !== 0 && (
        <span className={entry.affinityChange > 0 ? 'text-green-400' : 'text-red-400'}>
          {' '}好感度{entry.affinityChange > 0 ? '+' : ''}{entry.affinityChange}
        </span>
      )}
      {entry.npcMood && (
        <span className="text-slate-500"> ({entry.npcMood})</span>
      )}
    </div>
  )
}

function ConversationMessageLogLine({ entry }: { entry: ConversationMessageLogEntry }) {
  return (
    <div className="text-sm text-slate-300 py-0.5 pl-4">
      <span className="text-slate-500">[{entry.time}]</span>{' '}
      <span className={entry.speaker === 'character' ? 'text-blue-300' : 'text-green-300'}>
        {entry.speakerName}
      </span>
      <span className="text-slate-400">: </span>
      <span className="text-slate-200">{entry.utterance}</span>
    </div>
  )
}

function MiniEpisodeLogLine({ entry }: { entry: MiniEpisodeLogEntry }) {
  const statStr = Object.entries(entry.statChanges)
    .map(([key, val]) => `${key}${val > 0 ? '+' : ''}${val}`)
    .join(' ')

  return (
    <div className="text-sm text-slate-300 py-0.5 pl-4">
      <span className="text-slate-500">[{entry.time}]</span>{' '}
      <span className="text-blue-300 font-medium">{entry.characterName}</span>{' '}
      <span className="text-yellow-300">✨ {entry.episode}</span>
      {statStr && <span className="text-slate-500"> ({statStr})</span>}
    </div>
  )
}

function DebugLLMBehaviorLogLine({ entry }: { entry: DebugLLMBehaviorLogEntry }) {
  const [expanded, setExpanded] = useState(false)

  const stageLabel = {
    action_decision: '行動決定',
    facility_selection: '施設選択',
    interrupt_facility: '緊急施設選択',
  }[entry.stage] || entry.stage

  return (
    <div className="text-sm text-slate-300 py-0.5 pl-4 border-l-2 border-orange-500/30">
      <div
        className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/30 rounded px-1"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-orange-500">{expanded ? '▼' : '▶'}</span>
        <span className="text-slate-500">[{entry.time}]</span>{' '}
        <span className="text-blue-300 font-medium">{entry.characterName}</span>{' '}
        <span className="text-orange-400 text-xs px-1 bg-orange-900/30 rounded">🔧 {stageLabel}</span>
      </div>
      {expanded && (
        <div className="mt-2 ml-4 space-y-2">
          <div>
            <div className="text-xs text-slate-500 mb-1">Prompt:</div>
            <pre className="text-xs bg-slate-900 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-400">
              {entry.prompt}
            </pre>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Response:</div>
            <pre className="text-xs bg-slate-900 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap text-green-400">
              {entry.response}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function DebugConversationTurnLogLine({ entry }: { entry: DebugConversationTurnLogEntry }) {
  const [expanded, setExpanded] = useState(false)

  const speakerLabel = entry.speaker === 'character' ? entry.characterName : entry.npcName

  return (
    <div className="text-sm text-slate-300 py-0.5 pl-4 border-l-2 border-purple-500/30">
      <div
        className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/30 rounded px-1"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-purple-500">{expanded ? '▼' : '▶'}</span>
        <span className="text-slate-500">[{entry.time}]</span>{' '}
        <span className="text-purple-400 text-xs px-1 bg-purple-900/30 rounded">💬 Turn {entry.turn}</span>{' '}
        <span className={entry.speaker === 'character' ? 'text-blue-300' : 'text-green-300'}>
          {speakerLabel}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 ml-4 space-y-2">
          <div>
            <div className="text-xs text-slate-500 mb-1">Prompt:</div>
            <pre className="text-xs bg-slate-900 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-400">
              {entry.prompt}
            </pre>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Response:</div>
            <pre className="text-xs bg-slate-900 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap text-green-400">
              {entry.response}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function LogEntry({ entry }: { entry: ActivityLogEntry }) {
  switch (entry.type) {
    case 'action':
      return <ActionLogLine entry={entry} />
    case 'conversation':
      return <ConversationLogLine entry={entry} />
    case 'conversation_message':
      return <ConversationMessageLogLine entry={entry} />
    case 'mini_episode':
      return <MiniEpisodeLogLine entry={entry} />
    case 'debug_llm_behavior':
      return <DebugLLMBehaviorLogLine entry={entry} />
    case 'debug_conversation_turn':
      return <DebugConversationTurnLogLine entry={entry} />
  }
}

export function ActivityLogPanel() {
  const entries = useActivityLogStore((s) => s.entries)
  const setEntries = useActivityLogStore((s) => s.setEntries)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAutoScrollRef = useRef(true)

  // Fetch initial logs on mount
  useEffect(() => {
    fetch('/api/activity-log')
      .then((res) => res.json())
      .then((data: ActivityLogEntry[]) => {
        setEntries(data, 0)
      })
      .catch((err) => {
        console.error('[ActivityLogPanel] Failed to fetch logs:', err)
      })
  }, [setEntries])

  // Auto-scroll to bottom when new entries are added
  useEffect(() => {
    if (isAutoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  // Track if user has scrolled away from bottom
  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    isAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30
  }

  // Filter out 'thinking' action entries
  const visibleEntries = entries.filter(
    (e) => !(e.type === 'action' && e.actionId === 'thinking')
  )

  return (
    <div className="bg-slate-800 border-t border-slate-700 flex-1 flex flex-col min-h-0">
      <div className="px-3 py-1 border-b border-slate-700 flex items-center shrink-0">
        <h3 className="text-xs font-medium text-slate-400">Activity Log</h3>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs"
      >
        {visibleEntries.length === 0 ? (
          <div className="text-slate-500 py-2 text-center">No activity yet</div>
        ) : (
          visibleEntries.map((entry, i) => (
            <LogEntry key={i} entry={entry} />
          ))
        )}
      </div>
    </div>
  )
}

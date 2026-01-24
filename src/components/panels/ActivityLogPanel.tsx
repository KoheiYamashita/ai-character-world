'use client'

import { useEffect, useRef } from 'react'
import { useActivityLogStore } from '@/stores'
import type { ActivityLogEntry, ActionLogEntry, ConversationLogEntry, ConversationMessageLogEntry } from '@/types'

const ACTION_LABELS: Record<string, string> = {
  eat: '食事',
  sleep: '睡眠',
  bathe: '入浴',
  rest: '休憩',
  work: '仕事',
  toilet: 'トイレ',
  talk: '会話',
  thinking: '思考中',
}

function getActionLabel(actionId: string): string {
  return ACTION_LABELS[actionId] ?? actionId
}

function ActionLogLine({ entry }: { entry: ActionLogEntry }) {
  return (
    <div className="text-sm text-slate-300 py-0.5">
      <span className="text-slate-500">[{entry.time}]</span>{' '}
      <span className="text-blue-300 font-medium">{entry.characterName}</span>{' '}
      <span className="text-slate-400">- {getActionLabel(entry.actionId)}</span>
      {entry.target && <span className="text-slate-500"> @ {entry.target}</span>}
      {entry.reason && <span className="text-slate-500">: {entry.reason}</span>}
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

function LogEntry({ entry }: { entry: ActivityLogEntry }) {
  switch (entry.type) {
    case 'action':
      return <ActionLogLine entry={entry} />
    case 'conversation':
      return <ConversationLogLine entry={entry} />
    case 'conversation_message':
      return <ConversationMessageLogLine entry={entry} />
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
    <div className="bg-slate-800 rounded-lg border border-slate-700">
      <div className="px-3 py-2 border-b border-slate-700">
        <h3 className="text-sm font-medium text-slate-300">Activity Log</h3>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-64 overflow-y-auto px-3 py-1 font-mono text-xs"
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

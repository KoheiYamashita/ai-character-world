'use client'

import { useEffect, useRef } from 'react'
import { useActivityLogStore } from '@/stores'
import type { ActivityLogEntry, ActionLogEntry, ConversationLogEntry, ConversationMessageLogEntry, MiniEpisodeLogEntry } from '@/types'

const ACTION_LABELS: Record<string, string> = {
  eat: '食事',
  sleep: '睡眠',
  bathe: '入浴',
  rest: '休憩',
  work: '仕事',
  toilet: 'トイレ',
  talk: '会話',
  thinking: '思考中',
  move: '移動',
  idle: '待機',
}

function getActionLabel(actionId: string): string {
  return ACTION_LABELS[actionId] ?? actionId
}

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

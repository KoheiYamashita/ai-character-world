'use client';

import { useEffect, useState, useCallback } from 'react';
import Script from 'next/script';
import { ACTION_INFO } from '@/lib/uiLabels';

type Database = {
  exec: (sql: string) => { columns: string[]; values: unknown[][] }[];
};

type CharacterState = {
  id: string;
  name: string;
  satiety: number | null;
  energy: number | null;
  hygiene: number | null;
  mood: number | null;
  bladder: number | null;
  money: number | null;
  current_map_id: string | null;
  current_node_id: string | null;
  sprite: string | null;
  employment: string | null;
};

type WorldTime = {
  hour: number;
  minute: number;
  day: number;
};

type ServerState = {
  server_start_time: string | null;
  current_map_id: string | null;
};

type ActionHistory = {
  id: number;
  character_id: string;
  character_name: string | null;
  day: number;
  time: string | null;
  action_id: string | null;
  target: string | null;
  duration_minutes: number | null;
  reason: string | null;
  created_at: number;
};

type NpcSummary = {
  id: number;
  character_id: string;
  character_name: string | null;
  npc_id: string;
  npc_name: string;
  summary: string;
  topics: string;
  affinity_change: number | null;
  day: number;
  time: string | null;
};

type Schedule = {
  character_id: string;
  character_name: string | null;
  day: number;
  entries: string;
};

type ScheduleEntry = {
  time?: string;
  activity?: string;
  location?: string;
  note?: string;
};

type DebugLog = {
  id: number;
  type: string;
  character_id: string;
  character_name: string | null;
  day: number;
  time: string;
  data: string;
  created_at: number;
};

// タイムラインイベント統合型
type TimelineEvent = {
  type: 'action' | 'schedule' | 'conversation' | 'debug';
  day: number;
  time: string;
  sortKey: string; // ソート用: "day-time"
  characterId: string;
  characterName: string;
  data: ActionHistory | { entry: ScheduleEntry; schedule: Schedule } | NpcSummary | DebugLog;
};

// Utility function to parse JSON safely
function parseJson(str: string | null): unknown {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

declare global {
  interface Window {
    initSqlJs: (config: { locateFile: (file: string) => string }) => Promise<{
      Database: new (data: Uint8Array) => Database;
    }>;
  }
}

export default function LogViewer() {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [sqlJsLoaded, setSqlJsLoaded] = useState(false);

  // Timeline Filters
  const [timelineCharFilter, setTimelineCharFilter] = useState('');
  const [timelineDayFilter, setTimelineDayFilter] = useState('');
  const [timelineEventTypeFilter, setTimelineEventTypeFilter] = useState<'' | 'action' | 'schedule' | 'conversation' | 'debug'>('');

  // Data
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [worldTime, setWorldTime] = useState<WorldTime | null>(null);
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [timelineDays, setTimelineDays] = useState<number[]>([]);

  const query = useCallback(
    <T,>(sql: string): T[] => {
      if (!db) return [];
      try {
        const result = db.exec(sql);
        if (result.length === 0) return [];
        const columns = result[0].columns;
        return result[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          columns.forEach((col, i) => (obj[col] = row[i]));
          return obj as T;
        });
      } catch (e) {
        console.error('Query error:', sql, e);
        return [];
      }
    },
    [db]
  );

  // Load database
  useEffect(() => {
    if (!sqlJsLoaded) return;

    async function loadDb() {
      try {
        const SQL = await window.initSqlJs({
          locateFile: (file) =>
            `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`,
        });

        const response = await fetch('/api/db');
        if (!response.ok) {
          throw new Error('Failed to fetch database');
        }

        const arrayBuffer = await response.arrayBuffer();
        const database = new SQL.Database(new Uint8Array(arrayBuffer));
        setDb(database);
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
        setLoading(false);
      }
    }

    loadDb();
  }, [sqlJsLoaded]);

  // Load data when db is ready
  useEffect(() => {
    if (!db) return;

    setCharacters(query<CharacterState>('SELECT * FROM character_states'));
    setWorldTime(query<WorldTime>('SELECT * FROM world_time')[0] || null);
    setServerState(query<ServerState>('SELECT * FROM server_state')[0] || null);

    // タイムライン用日付（3テーブルのユニオン）
    const days = new Set<number>();
    query<{ day: number }>('SELECT DISTINCT day FROM schedules').forEach(r => days.add(r.day));
    query<{ day: number }>('SELECT DISTINCT day FROM action_history').forEach(r => days.add(r.day));
    query<{ day: number }>('SELECT DISTINCT day FROM npc_summaries').forEach(r => days.add(r.day));
    setTimelineDays([...days].sort((a, b) => a - b));
  }, [db, query]);

  const escapeHtml = (str: string | null) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  const formatTime = (h: number | undefined, m: number | undefined) => {
    const hour = String(h || 0).padStart(2, '0');
    const min = String(m || 0).padStart(2, '0');
    return `${hour}:${min}`;
  };

  // タイムラインイベントの取得・統合
  const getTimelineEvents = useCallback((): TimelineEvent[] => {
    if (!db) return [];
    const events: TimelineEvent[] = [];

    // 行動履歴
    if (!timelineEventTypeFilter || timelineEventTypeFilter === 'action') {
      let sql = 'SELECT h.*, c.name as character_name FROM action_history h LEFT JOIN character_states c ON h.character_id = c.id WHERE 1=1';
      if (timelineCharFilter) sql += ` AND h.character_id = '${timelineCharFilter}'`;
      if (timelineDayFilter) sql += ` AND h.day = ${timelineDayFilter}`;
      sql += ' ORDER BY h.day, h.time';
      const actions = query<ActionHistory>(sql);
      actions.forEach(a => {
        const time = a.time || '00:00';
        events.push({
          type: 'action',
          day: a.day,
          time,
          sortKey: `${String(a.day).padStart(5, '0')}-${time}`,
          characterId: a.character_id,
          characterName: a.character_name || a.character_id,
          data: a,
        });
      });
    }

    // スケジュール
    if (!timelineEventTypeFilter || timelineEventTypeFilter === 'schedule') {
      let sql = 'SELECT s.*, c.name as character_name FROM schedules s LEFT JOIN character_states c ON s.character_id = c.id WHERE 1=1';
      if (timelineCharFilter) sql += ` AND s.character_id = '${timelineCharFilter}'`;
      if (timelineDayFilter) sql += ` AND s.day = ${timelineDayFilter}`;
      sql += ' ORDER BY s.day, s.character_id';
      const schedules = query<Schedule>(sql);
      schedules.forEach(s => {
        const entries = parseJson(s.entries) as ScheduleEntry[] | null;
        if (entries && Array.isArray(entries)) {
          entries.forEach(entry => {
            const time = entry.time || '00:00';
            events.push({
              type: 'schedule',
              day: s.day,
              time,
              sortKey: `${String(s.day).padStart(5, '0')}-${time}`,
              characterId: s.character_id,
              characterName: s.character_name || s.character_id,
              data: { entry, schedule: s },
            });
          });
        }
      });
    }

    // NPC会話サマリ
    if (!timelineEventTypeFilter || timelineEventTypeFilter === 'conversation') {
      let sql = `SELECT ns.*, c.name as character_name FROM npc_summaries ns LEFT JOIN character_states c ON ns.character_id = c.id WHERE 1=1`;
      if (timelineCharFilter) sql += ` AND ns.character_id = '${timelineCharFilter}'`;
      if (timelineDayFilter) sql += ` AND ns.day = ${timelineDayFilter}`;
      sql += ' ORDER BY ns.day, ns.time';
      const summaries = query<NpcSummary>(sql);
      summaries.forEach(s => {
        const time = s.time || '00:00';
        events.push({
          type: 'conversation',
          day: s.day,
          time,
          sortKey: `${String(s.day).padStart(5, '0')}-${time}`,
          characterId: s.character_id,
          characterName: s.character_name || s.character_id,
          data: s,
        });
      });
    }

    // デバッグログ
    if (timelineEventTypeFilter === 'debug') {
      // debug_logsテーブルが存在するか確認
      const tableExists = query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='debug_logs'"
      ).length > 0;

      if (tableExists) {
        let sql = 'SELECT d.*, c.name as character_name FROM debug_logs d LEFT JOIN character_states c ON d.character_id = c.id WHERE 1=1';
        if (timelineCharFilter) sql += ` AND d.character_id = '${timelineCharFilter}'`;
        if (timelineDayFilter) sql += ` AND d.day = ${timelineDayFilter}`;
        sql += ' ORDER BY d.day, d.time, d.created_at';
        const debugLogs = query<DebugLog>(sql);
        debugLogs.forEach(d => {
          const time = d.time || '00:00';
          events.push({
            type: 'debug',
            day: d.day,
            time,
            sortKey: `${String(d.day).padStart(5, '0')}-${time}-${String(d.created_at).padStart(15, '0')}`,
            characterId: d.character_id,
            characterName: d.character_name || d.character_id,
            data: d,
          });
        });
      }
    }

    // 時系列でソート（降順: 新しいものが上）
    events.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return events;
  }, [db, query, timelineCharFilter, timelineDayFilter, timelineEventTypeFilter]);

  return (
    <>
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.min.js"
        onLoad={() => setSqlJsLoaded(true)}
      />
      <div className="min-h-screen bg-[#1a1a2e] text-gray-200 p-5">
        <h1 className="text-center text-2xl font-bold mb-5 text-[#6dd5ed]">
          AI Character World - Log Viewer
        </h1>

        {loading && (
          <div className="text-center py-10 text-gray-400">
            データベースを読み込み中...
          </div>
        )}

        {error && (
          <div className="text-center py-10 text-red-400">エラー: {error}</div>
        )}

        {!loading && !error && db && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 mb-5 flex-wrap">
              {['overview', 'characters', 'timeline'].map((tab) => (
                <button
                  key={tab}
                  className={`px-5 py-2.5 rounded-t-lg border-none cursor-pointer text-sm transition-all ${
                    activeTab === tab
                      ? 'bg-[#3a3a6a] text-[#6dd5ed]'
                      : 'bg-[#2a2a4a] text-gray-500 hover:bg-[#3a3a5a] hover:text-gray-300'
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'overview' && '概要'}
                  {tab === 'characters' && 'キャラクター'}
                  {tab === 'timeline' && 'タイムライン'}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="bg-[#252540] rounded-b-xl rounded-tr-xl p-5 min-h-[400px]">
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div>
                  <h3 className="text-[#6dd5ed] text-base mb-4 pb-2.5 border-b border-[#3a3a5a]">
                    ワールド状態
                  </h3>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-5">
                    <div className="bg-[#1a1a2e] p-4 rounded-lg border-l-4 border-[#6dd5ed]">
                      <h4 className="text-gray-500 text-xs uppercase mb-2">
                        ワールド時間
                      </h4>
                      <div className="text-2xl text-[#6dd5ed] font-semibold">
                        {formatTime(worldTime?.hour, worldTime?.minute)}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        Day {worldTime?.day || 1}
                      </div>
                    </div>
                    <div className="bg-[#1a1a2e] p-4 rounded-lg border-l-4 border-[#6dd5ed]">
                      <h4 className="text-gray-500 text-xs uppercase mb-2">
                        サーバー起動
                      </h4>
                      <div className="text-sm text-[#6dd5ed] font-semibold">
                        {serverState?.server_start_time || '-'}
                      </div>
                    </div>
                    <div className="bg-[#1a1a2e] p-4 rounded-lg border-l-4 border-[#6dd5ed]">
                      <h4 className="text-gray-500 text-xs uppercase mb-2">
                        現在のマップ
                      </h4>
                      <div className="text-lg text-[#6dd5ed] font-semibold">
                        {serverState?.current_map_id || '-'}
                      </div>
                    </div>
                    <div className="bg-[#1a1a2e] p-4 rounded-lg border-l-4 border-[#6dd5ed]">
                      <h4 className="text-gray-500 text-xs uppercase mb-2">
                        キャラクター数
                      </h4>
                      <div className="text-2xl text-[#6dd5ed] font-semibold">
                        {characters.length}
                      </div>
                    </div>
                  </div>

                  <h3 className="text-[#6dd5ed] text-base mb-4 pb-2.5 border-b border-[#3a3a5a]">
                    キャラクターサマリ
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            名前
                          </th>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            位置
                          </th>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            満腹度
                          </th>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            体力
                          </th>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            衛生
                          </th>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            気分
                          </th>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            膀胱
                          </th>
                          <th className="bg-[#1a1a2e] text-[#6dd5ed] font-semibold p-3 text-left sticky top-0">
                            所持金
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {characters.map((c) => (
                          <tr key={c.id} className="hover:bg-[#2a2a4a]">
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.name}
                            </td>
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.current_map_id || '-'}
                            </td>
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.satiety ?? '-'}
                            </td>
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.energy ?? '-'}
                            </td>
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.hygiene ?? '-'}
                            </td>
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.mood ?? '-'}
                            </td>
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.bladder ?? '-'}
                            </td>
                            <td className="p-3 border-b border-[#3a3a5a]">
                              {c.money ?? '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Characters Tab */}
              {activeTab === 'characters' && (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
                  {characters.map((c) => {
                    const employment = parseJson(c.employment);
                    return (
                      <div
                        key={c.id}
                        className="bg-[#1a1a2e] rounded-xl p-5"
                      >
                        <div className="flex items-center gap-4 mb-4">
                          <div className="w-14 h-14 bg-[#3a3a6a] rounded-full flex items-center justify-center text-2xl">
                            {c.name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <h3 className="text-[#6dd5ed] mb-1">{c.name}</h3>
                            <p className="text-gray-500 text-xs">ID: {c.id}</p>
                            <p className="text-gray-500 text-xs">
                              {employment?.job || '無職'} @{' '}
                              {employment?.workplace || '-'}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-2.5">
                          <StatusBar label="満腹度" value={c.satiety} type="satiety" />
                          <StatusBar label="体力" value={c.energy} type="energy" />
                          <StatusBar label="衛生" value={c.hygiene} type="hygiene" />
                          <StatusBar label="気分" value={c.mood} type="mood" />
                          <StatusBar label="膀胱" value={c.bladder} type="bladder" />
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">所持金</span>
                            <span className="font-medium">¥{c.money ?? 0}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">現在地</span>
                            <span className="font-medium">
                              {c.current_map_id || '-'} (Node:{' '}
                              {c.current_node_id ?? '-'})
                            </span>
                          </div>
                        </div>
                        <JsonSection
                          title="スプライト設定"
                          data={c.sprite}
                        />
                        <JsonSection
                          title="雇用情報"
                          data={c.employment}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Timeline Tab */}
              {activeTab === 'timeline' && (
                <div>
                  {/* フィルタ */}
                  <div className="flex gap-4 mb-5 flex-wrap items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-gray-500 text-sm">キャラクター:</label>
                      <select
                        className="px-3 py-2 bg-[#1a1a2e] border border-[#4a4a6a] rounded-md text-gray-200 text-sm cursor-pointer focus:outline-none focus:border-[#6dd5ed]"
                        value={timelineCharFilter}
                        onChange={(e) => setTimelineCharFilter(e.target.value)}
                      >
                        <option value="">全員</option>
                        {characters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-gray-500 text-sm">日:</label>
                      <select
                        className="px-3 py-2 bg-[#1a1a2e] border border-[#4a4a6a] rounded-md text-gray-200 text-sm cursor-pointer focus:outline-none focus:border-[#6dd5ed]"
                        value={timelineDayFilter}
                        onChange={(e) => setTimelineDayFilter(e.target.value)}
                      >
                        <option value="">全日</option>
                        {timelineDays.map((d) => (
                          <option key={d} value={d}>
                            Day {d}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-gray-500 text-sm">種別:</label>
                      <select
                        className="px-3 py-2 bg-[#1a1a2e] border border-[#4a4a6a] rounded-md text-gray-200 text-sm cursor-pointer focus:outline-none focus:border-[#6dd5ed]"
                        value={timelineEventTypeFilter}
                        onChange={(e) => setTimelineEventTypeFilter(e.target.value as '' | 'action' | 'schedule' | 'conversation' | 'debug')}
                      >
                        <option value="">全て</option>
                        <option value="action">行動</option>
                        <option value="schedule">予定</option>
                        <option value="conversation">会話</option>
                        <option value="debug">🔧 デバッグ</option>
                      </select>
                    </div>
                  </div>

                  {/* タイムライン表示 */}
                  {(() => {
                    const events = getTimelineEvents();
                    if (events.length === 0) {
                      return (
                        <div className="text-center py-16 text-gray-600">
                          タイムラインデータがありません
                        </div>
                      );
                    }

                    // 日付ごとにグループ化
                    const eventsByDay: Record<number, TimelineEvent[]> = {};
                    events.forEach(e => {
                      if (!eventsByDay[e.day]) eventsByDay[e.day] = [];
                      eventsByDay[e.day].push(e);
                    });

                    const sortedDays = Object.keys(eventsByDay).map(Number).sort((a, b) => b - a);

                    return sortedDays.map(day => (
                      <div key={day} className="mb-8">
                        <h3 className="text-[#6dd5ed] text-base mb-4 pb-2.5 border-b border-[#3a3a5a]">
                          📅 Day {day}
                        </h3>
                        <div className="relative pl-8 before:content-[''] before:absolute before:left-2.5 before:top-0 before:bottom-0 before:w-0.5 before:bg-[#3a3a5a]">
                          {eventsByDay[day].map((event, idx) => (
                            <TimelineEventCard key={`${event.type}-${idx}`} event={event} escapeHtml={escapeHtml} />
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function StatusBar({
  label,
  value,
  type,
}: {
  label: string;
  value: number | null;
  type: string;
}) {
  const val = value ?? 0;
  const gradients: Record<string, string> = {
    satiety: 'from-red-400 to-yellow-300',
    energy: 'from-teal-400 to-cyan-300',
    hygiene: 'from-green-300 to-emerald-400',
    mood: 'from-purple-300 to-violet-400',
    bladder: 'from-yellow-200 to-yellow-400',
  };

  return (
    <>
      <div className="flex justify-between items-center">
        <span className="text-gray-500 text-sm">{label}</span>
        <span className="font-medium">{val}</span>
      </div>
      <div className="h-2 bg-[#1a1a2e] rounded overflow-hidden mt-1">
        <div
          className={`h-full rounded bg-gradient-to-r ${gradients[type] || ''}`}
          style={{ width: `${val}%` }}
        />
      </div>
    </>
  );
}

function JsonSection({
  title,
  data,
}: {
  title: string;
  data: string | null;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const parsed = data ? (() => {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  })() : null;

  if (!parsed) {
    return (
      <div className="mt-4">
        <h4 className="text-gray-500 text-xs mb-2">{title}</h4>
        <span className="text-gray-600">-</span>
      </div>
    );
  }

  const formatted = JSON.stringify(parsed, null, 2);

  return (
    <div className="mt-4">
      <h4 className="text-gray-500 text-xs mb-2">{title}</h4>
      <button
        className="bg-[#3a3a6a] border-none text-[#6dd5ed] px-2 py-1 rounded text-xs cursor-pointer hover:bg-[#4a4a7a] mb-1"
        onClick={() => setCollapsed(!collapsed)}
      >
        展開/折りたたみ
      </button>
      <pre
        className={`bg-[#1a1a2e] p-2.5 rounded-md overflow-x-auto whitespace-pre-wrap font-mono text-xs ${
          collapsed ? 'max-h-16 overflow-hidden' : 'max-h-72 overflow-y-auto'
        }`}
      >
        {formatted}
      </pre>
    </div>
  );
}

// タイムラインイベントのスタイル設定
const EVENT_STYLES: Record<TimelineEvent['type'], { color: string; icon: string }> = {
  action: { color: 'bg-blue-500', icon: '' },
  schedule: { color: 'bg-green-500', icon: '📋' },
  conversation: { color: 'bg-purple-500', icon: '💬' },
  debug: { color: 'bg-orange-500', icon: '🔧' },
};

// タイムラインイベントカード
function TimelineEventCard({
  event,
  escapeHtml,
}: {
  event: TimelineEvent;
  escapeHtml: (str: string | null) => string;
}) {
  const { color, icon } = EVENT_STYLES[event.type];

  // 共通のカードラッパー
  const cardBaseClass = `relative p-3 bg-[#1a1a2e] rounded-lg mb-2.5 before:content-[''] before:absolute before:-left-6 before:top-4 before:w-2.5 before:h-2.5 before:rounded-full before:${color}`;

  // 共通のヘッダー部分
  const renderHeader = (badgeContent: string) => (
    <div className="flex justify-between items-start mb-1">
      <div className="flex items-center gap-2">
        <span className="text-[#6dd5ed] font-semibold">{event.time}</span>
        <span className={`${color} px-1.5 py-0.5 rounded text-xs text-white`}>
          {badgeContent}
        </span>
      </div>
      <span className="text-gray-500 text-xs">{event.characterName}</span>
    </div>
  );

  // 行動イベント
  if (event.type === 'action') {
    const action = event.data as ActionHistory;
    const actionInfo = ACTION_INFO[action.action_id as keyof typeof ACTION_INFO];
    const emoji = actionInfo?.emoji ?? '';
    const label = actionInfo?.label ?? action.action_id;

    return (
      <div className={cardBaseClass}>
        {renderHeader(`${emoji} ${label}`)}
        {action.target && (
          <div className="text-gray-400 text-sm mb-1">
            📍 {action.target}
            {action.duration_minutes && ` (${action.duration_minutes}分)`}
          </div>
        )}
        {action.reason && (
          <div className="text-gray-500 text-xs mt-1">
            └─ {escapeHtml(action.reason).replace(/\n/g, ' ')}
          </div>
        )}
      </div>
    );
  }

  // スケジュールイベント
  if (event.type === 'schedule') {
    const { entry } = event.data as { entry: ScheduleEntry; schedule: Schedule };

    return (
      <div className={cardBaseClass}>
        {renderHeader(`${icon} 予定`)}
        <div className="text-gray-300 mb-1">{entry.activity || '-'}</div>
        {entry.location && (
          <div className="text-gray-500 text-xs">📍 {entry.location}</div>
        )}
        {entry.note && (
          <div className="text-gray-600 text-xs italic mt-1">{entry.note}</div>
        )}
      </div>
    );
  }

  // 会話イベント
  if (event.type === 'conversation') {
    const summary = event.data as NpcSummary;
    let topics: string[] = [];
    try {
      topics = JSON.parse(summary.topics);
    } catch {
      topics = summary.topics ? [summary.topics] : [];
    }

    return (
      <div className={cardBaseClass}>
        {renderHeader(`${icon} 会話 (${summary.npc_name}と)`)}
        <div className="text-gray-300 text-sm mb-1">
          └─ {summary.summary}
        </div>
        {topics.length > 0 && (
          <div className="text-gray-500 text-xs mb-1">
            話題: {topics.map((t, i) => (
              <span key={i} className="bg-[#3a3a5a] px-1 py-0.5 rounded mr-1">{t}</span>
            ))}
          </div>
        )}
        {summary.affinity_change !== null && summary.affinity_change !== 0 && (
          <div className={`text-xs ${summary.affinity_change > 0 ? 'text-green-400' : 'text-red-400'}`}>
            好感度: {summary.affinity_change > 0 ? '+' : ''}{summary.affinity_change}
          </div>
        )}
      </div>
    );
  }

  // デバッグイベント
  if (event.type === 'debug') {
    const debugLog = event.data as DebugLog;
    let parsedData: Record<string, unknown> = {};
    try {
      parsedData = JSON.parse(debugLog.data);
    } catch {
      // ignore
    }

    const debugType = debugLog.type;
    const typeLabel = debugType === 'llm_behavior'
      ? '行動決定'
      : debugType === 'conversation_turn'
        ? '会話ターン'
        : debugType;

    const stage = parsedData.stage as string | undefined;
    const stageLabel = stage
      ? ({
          action_decision: '行動決定',
          facility_selection: '施設選択',
          interrupt_facility: '緊急施設選択',
        }[stage] || stage)
      : '';

    return (
      <DebugLogCard
        cardBaseClass={cardBaseClass}
        renderHeader={renderHeader}
        icon={icon}
        typeLabel={typeLabel}
        stageLabel={stageLabel}
        parsedData={parsedData}
      />
    );
  }

  return null;
}

// デバッグログカード（折りたたみ式）
function DebugLogCard({
  cardBaseClass,
  renderHeader,
  icon,
  typeLabel,
  stageLabel,
  parsedData,
}: {
  cardBaseClass: string;
  renderHeader: (badgeContent: string) => React.ReactNode;
  icon: string;
  typeLabel: string;
  stageLabel: string;
  parsedData: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);

  const prompt = parsedData.prompt as string | undefined;
  const response = parsedData.response as string | undefined;
  const turn = parsedData.turn as number | undefined;
  const speaker = parsedData.speaker as string | undefined;

  return (
    <div className={cardBaseClass}>
      <div
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {renderHeader(
          `${icon} ${typeLabel}${stageLabel ? ` (${stageLabel})` : ''}${turn ? ` Turn ${turn}` : ''}${speaker ? ` - ${speaker}` : ''}`
        )}
        <div className="text-gray-500 text-xs mt-1">
          {expanded ? '▼ 折りたたむ' : '▶ 詳細を表示'}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {prompt && (
            <div>
              <div className="text-gray-500 text-xs mb-1">Prompt:</div>
              <pre className="text-xs bg-[#1a1a2e] p-2 rounded overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap text-gray-400">
                {prompt}
              </pre>
            </div>
          )}
          {response && (
            <div>
              <div className="text-gray-500 text-xs mb-1">Response:</div>
              <pre className="text-xs bg-[#1a1a2e] p-2 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap text-green-400">
                {response}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

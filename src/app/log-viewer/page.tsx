'use client';

import { useEffect, useState, useCallback } from 'react';
import Script from 'next/script';

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

type Schedule = {
  character_id: string;
  character_name: string | null;
  day: number;
  entries: string;
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

  // Filters
  const [scheduleCharFilter, setScheduleCharFilter] = useState('');
  const [scheduleDayFilter, setScheduleDayFilter] = useState('');
  const [historyCharFilter, setHistoryCharFilter] = useState('');
  const [historyDayFilter, setHistoryDayFilter] = useState('');
  const [historyActionFilter, setHistoryActionFilter] = useState('');

  // Data
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [worldTime, setWorldTime] = useState<WorldTime | null>(null);
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [historyDays, setHistoryDays] = useState<number[]>([]);
  const [actionIds, setActionIds] = useState<string[]>([]);

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
    setScheduleDays(
      query<{ day: number }>('SELECT DISTINCT day FROM schedules ORDER BY day').map(
        (r) => r.day
      )
    );
    setHistoryDays(
      query<{ day: number }>(
        'SELECT DISTINCT day FROM action_history ORDER BY day'
      ).map((r) => r.day)
    );
    setActionIds(
      query<{ action_id: string }>(
        'SELECT DISTINCT action_id FROM action_history ORDER BY action_id'
      ).map((r) => r.action_id)
    );
  }, [db, query]);

  const parseJson = (str: string | null) => {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };

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

  const getSchedules = useCallback(() => {
    if (!db) return [];
    let sql =
      'SELECT s.*, c.name as character_name FROM schedules s LEFT JOIN character_states c ON s.character_id = c.id WHERE 1=1';
    if (scheduleCharFilter) sql += ` AND s.character_id = '${scheduleCharFilter}'`;
    if (scheduleDayFilter) sql += ` AND s.day = ${scheduleDayFilter}`;
    sql += ' ORDER BY s.day, s.character_id';
    return query<Schedule>(sql);
  }, [db, query, scheduleCharFilter, scheduleDayFilter]);

  const getHistory = useCallback(() => {
    if (!db) return [];
    let sql =
      'SELECT h.*, c.name as character_name FROM action_history h LEFT JOIN character_states c ON h.character_id = c.id WHERE 1=1';
    if (historyCharFilter) sql += ` AND h.character_id = '${historyCharFilter}'`;
    if (historyDayFilter) sql += ` AND h.day = ${historyDayFilter}`;
    if (historyActionFilter) sql += ` AND h.action_id = '${historyActionFilter}'`;
    sql += ' ORDER BY h.day DESC, h.time DESC';
    return query<ActionHistory>(sql);
  }, [db, query, historyCharFilter, historyDayFilter, historyActionFilter]);

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
              {['overview', 'characters', 'schedules', 'history'].map((tab) => (
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
                  {tab === 'schedules' && 'スケジュール'}
                  {tab === 'history' && '行動履歴'}
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

              {/* Schedules Tab */}
              {activeTab === 'schedules' && (
                <div>
                  <div className="flex gap-4 mb-5 flex-wrap items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-gray-500 text-sm">キャラクター:</label>
                      <select
                        className="px-3 py-2 bg-[#1a1a2e] border border-[#4a4a6a] rounded-md text-gray-200 text-sm cursor-pointer focus:outline-none focus:border-[#6dd5ed]"
                        value={scheduleCharFilter}
                        onChange={(e) => setScheduleCharFilter(e.target.value)}
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
                        value={scheduleDayFilter}
                        onChange={(e) => setScheduleDayFilter(e.target.value)}
                      >
                        <option value="">全日</option>
                        {scheduleDays.map((d) => (
                          <option key={d} value={d}>
                            Day {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {(() => {
                    const schedules = getSchedules();
                    if (schedules.length === 0) {
                      return (
                        <div className="text-center py-16 text-gray-600">
                          スケジュールデータがありません
                        </div>
                      );
                    }

                    let currentChar: string | null = null;
                    let currentDay: number | null = null;
                    const elements: React.ReactNode[] = [];

                    schedules.forEach((s, idx) => {
                      const entries = parseJson(s.entries) || [];

                      if (s.character_id !== currentChar || s.day !== currentDay) {
                        currentChar = s.character_id;
                        currentDay = s.day;
                        elements.push(
                          <div key={`header-${idx}`} className="mb-8">
                            <h3 className="text-[#6dd5ed] text-base mb-4 pb-2.5 border-b border-[#3a3a5a]">
                              {s.character_name || s.character_id} - Day {s.day}
                            </h3>
                            <div className="relative pl-8 before:content-[''] before:absolute before:left-2.5 before:top-0 before:bottom-0 before:w-0.5 before:bg-[#3a3a5a]">
                              {entries.map(
                                (
                                  entry: {
                                    time?: string;
                                    activity?: string;
                                    location?: string;
                                    note?: string;
                                  },
                                  i: number
                                ) => (
                                  <div
                                    key={i}
                                    className="relative p-3 bg-[#1a1a2e] rounded-lg mb-2.5 before:content-[''] before:absolute before:-left-6 before:top-4 before:w-2.5 before:h-2.5 before:bg-[#6dd5ed] before:rounded-full"
                                  >
                                    <div className="text-[#6dd5ed] font-semibold mb-1">
                                      {entry.time || '-'}
                                    </div>
                                    <div className="mb-1">{entry.activity || '-'}</div>
                                    <div className="text-gray-500 text-xs">
                                      📍 {entry.location || '-'}
                                    </div>
                                    {entry.note && (
                                      <div className="text-gray-600 text-xs italic mt-1">
                                        {entry.note}
                                      </div>
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        );
                      }
                    });

                    return elements;
                  })()}
                </div>
              )}

              {/* History Tab */}
              {activeTab === 'history' && (
                <div>
                  <div className="flex gap-4 mb-5 flex-wrap items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-gray-500 text-sm">キャラクター:</label>
                      <select
                        className="px-3 py-2 bg-[#1a1a2e] border border-[#4a4a6a] rounded-md text-gray-200 text-sm cursor-pointer focus:outline-none focus:border-[#6dd5ed]"
                        value={historyCharFilter}
                        onChange={(e) => setHistoryCharFilter(e.target.value)}
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
                        value={historyDayFilter}
                        onChange={(e) => setHistoryDayFilter(e.target.value)}
                      >
                        <option value="">全日</option>
                        {historyDays.map((d) => (
                          <option key={d} value={d}>
                            Day {d}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-gray-500 text-sm">アクション:</label>
                      <select
                        className="px-3 py-2 bg-[#1a1a2e] border border-[#4a4a6a] rounded-md text-gray-200 text-sm cursor-pointer focus:outline-none focus:border-[#6dd5ed]"
                        value={historyActionFilter}
                        onChange={(e) => setHistoryActionFilter(e.target.value)}
                      >
                        <option value="">全て</option>
                        {actionIds.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {(() => {
                    const history = getHistory();
                    if (history.length === 0) {
                      return (
                        <div className="text-center py-16 text-gray-600">
                          行動履歴データがありません
                        </div>
                      );
                    }

                    return history.map((h, idx) => (
                      <div
                        key={idx}
                        className="bg-[#1a1a2e] rounded-lg p-4 mb-2.5"
                      >
                        <div className="flex justify-between items-start mb-2.5">
                          <div>
                            <span className="bg-[#3a3a6a] px-2 py-1 rounded text-xs text-[#6dd5ed]">
                              {h.action_id || '-'}
                            </span>
                            <strong className="ml-2.5">
                              {h.character_name || h.character_id}
                            </strong>
                          </div>
                          <div className="text-gray-500 text-xs">
                            Day {h.day} {h.time || ''}
                          </div>
                        </div>
                        <div className="text-gray-500 text-sm mb-2">
                          対象: {h.target || '-'} | 所要時間:{' '}
                          {h.duration_minutes ?? '-'}分
                        </div>
                        {h.reason && (
                          <div className="bg-[#252540] p-2.5 rounded-md text-sm text-gray-400 leading-relaxed">
                            <strong>判断理由:</strong>
                            <br />
                            <span
                              dangerouslySetInnerHTML={{
                                __html: escapeHtml(h.reason).replace(/\n/g, '<br>'),
                              }}
                            />
                          </div>
                        )}
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

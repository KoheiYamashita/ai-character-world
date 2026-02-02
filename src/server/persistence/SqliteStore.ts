import Database from 'better-sqlite3'
import type { StateStore, ActiveActionEntry } from './StateStore'
import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, Direction, SpriteConfig, Employment, DailySchedule, ScheduleEntry, ConversationSummaryEntry, NPCDynamicState, NPCFact, CharacterStats } from '@/types'
import type { ActionHistoryEntry, MidTermMemory } from '@/types/behavior'
import type { ChatMessageRecord, ChatSummary, ChatProviderId } from '@/types/chat'
import * as path from 'path'
import * as fs from 'fs'

// Round to 2 decimal places for status values
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// Database row type for character_states table
interface CharacterRow {
  id: string
  name: string
  sprite: string // JSON
  employment: string | null // JSON
  money: number
  satiety: number
  energy: number
  hygiene: number
  mood: number
  bladder: number
  fitness: number
  current_map_id: string
  current_node_id: string
  position_x: number
  position_y: number
  direction: string
  updated_at: number
}

interface WorldTimeRow {
  id: number
  hour: number
  minute: number
  day: number
  updated_at: number
}

interface ScheduleRow {
  character_id: string
  day: number
  entries: string
}

interface ActionHistoryRow {
  id: number
  character_id: string
  day: number
  time: string
  action_id: string
  target: string | null
  duration_minutes: number | null
  reason: string | null
  episode: string | null
  created_at: number
  // New columns for action persistence
  status: string  // 'in_progress' | 'completed'
  start_time_real: number | null  // 開始実時刻
  end_time: string | null  // 完了時刻
  last_update_time: number | null  // 最終更新時刻
  stats_snapshot: string | null  // JSON: CharacterStats
}

/**
 * SQLite implementation of StateStore.
 * Persists state to disk, survives server restarts.
 */
export class SqliteStore implements StateStore {
  private db: Database.Database

  constructor(dbPath: string = 'data/state.db') {
    // Ensure data directory exists
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initTables()
  }

  private initTables(): void {
    this.db.exec(`
      -- Character states (all status fields)
      CREATE TABLE IF NOT EXISTS character_states (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sprite TEXT NOT NULL,
        employment TEXT,
        money INTEGER NOT NULL,
        satiety INTEGER NOT NULL,
        energy INTEGER NOT NULL,
        hygiene INTEGER NOT NULL,
        mood INTEGER NOT NULL,
        bladder INTEGER NOT NULL,
        fitness INTEGER NOT NULL DEFAULT 80,
        current_map_id TEXT NOT NULL,
        current_node_id TEXT NOT NULL,
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        direction TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- World time
      CREATE TABLE IF NOT EXISTS world_time (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hour INTEGER NOT NULL,
        minute INTEGER NOT NULL,
        day INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Server state
      CREATE TABLE IF NOT EXISTS server_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        server_start_time INTEGER NOT NULL,
        current_map_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Schedules
      -- Note: UNIQUE(character_id, day) automatically creates an index
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        entries TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(character_id, day)
      );

      -- Action history (1 record per action)
      CREATE TABLE IF NOT EXISTS action_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        time TEXT NOT NULL,
        action_id TEXT NOT NULL,
        target TEXT,
        duration_minutes INTEGER,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_action_history_character_day
        ON action_history(character_id, day);

      -- NPC conversation summaries
      CREATE TABLE IF NOT EXISTS npc_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        npc_id TEXT NOT NULL,
        npc_name TEXT NOT NULL,
        goal TEXT,
        summary TEXT NOT NULL,
        topics TEXT NOT NULL,
        goal_achieved INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        day INTEGER,
        time TEXT,
        affinity_change INTEGER,
        mood TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_npc_summaries_char_npc
        ON npc_summaries(character_id, npc_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_npc_summaries_day
        ON npc_summaries(day);

      -- Mid-term memories
      CREATE TABLE IF NOT EXISTS mid_term_memories (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        content TEXT NOT NULL,
        importance TEXT NOT NULL,
        created_day INTEGER NOT NULL,
        expires_day INTEGER NOT NULL,
        source_npc_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mid_term_memories_character
        ON mid_term_memories(character_id, expires_day);

      -- NPC dynamic states
      CREATE TABLE IF NOT EXISTS npc_states (
        npc_id TEXT PRIMARY KEY,
        affinity INTEGER NOT NULL DEFAULT 0,
        mood TEXT NOT NULL DEFAULT 'neutral',
        facts TEXT NOT NULL DEFAULT '[]',
        conversation_count INTEGER NOT NULL DEFAULT 0,
        last_conversation INTEGER,
        updated_at INTEGER NOT NULL
      );

      -- Debug logs (DEBUG_MODE=true 時のみ使用)
      CREATE TABLE IF NOT EXISTS debug_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        character_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        time TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_debug_logs_char_day
        ON debug_logs(character_id, day);

      CREATE INDEX IF NOT EXISTS idx_debug_logs_type
        ON debug_logs(type, day);

      -- Chat messages (7日間保持)
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        is_from_character INTEGER NOT NULL DEFAULT 0,
        character_id TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(provider_id, message_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
        ON chat_messages(provider_id, channel_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_chat_messages_created
        ON chat_messages(created_at);

      -- Chat summaries (チャンネルごとの要約)
      CREATE TABLE IF NOT EXISTS chat_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        last_interaction_at INTEGER NOT NULL,
        total_messages INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(character_id, provider_id, channel_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_summaries_character
        ON chat_summaries(character_id);
    `)

    // Migration: add episode column to action_history
    this.migrateActionHistoryEpisode()

    // Migration: add fitness column to character_states
    this.migrateCharacterFitness()
  }

  private migrateCharacterFitness(): void {
    const columns = this.db.pragma('table_info(character_states)') as Array<{ name: string }>
    const hasFitness = columns.some(c => c.name === 'fitness')
    if (!hasFitness) {
      this.db.prepare('ALTER TABLE character_states ADD COLUMN fitness INTEGER NOT NULL DEFAULT 80').run()
      console.log('[SqliteStore] Migrated: added fitness column to character_states')
    }
  }

  private migrateActionHistoryEpisode(): void {
    const columns = this.db.pragma('table_info(action_history)') as Array<{ name: string }>
    const hasEpisode = columns.some(c => c.name === 'episode')
    if (!hasEpisode) {
      this.db.prepare('ALTER TABLE action_history ADD COLUMN episode TEXT').run()
      console.log('[SqliteStore] Migrated: added episode column to action_history')
    }
    // Chain to next migration
    this.migrateActionHistoryPersistence()
  }

  private migrateActionHistoryPersistence(): void {
    const columns = this.db.pragma('table_info(action_history)') as Array<{ name: string }>
    const columnNames = new Set(columns.map(c => c.name))

    // Add status column with default 'completed' (existing records are completed)
    if (!columnNames.has('status')) {
      this.db.prepare("ALTER TABLE action_history ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'").run()
      console.log('[SqliteStore] Migrated: added status column to action_history')
    }

    // Add start_time_real column
    if (!columnNames.has('start_time_real')) {
      this.db.prepare('ALTER TABLE action_history ADD COLUMN start_time_real INTEGER').run()
      console.log('[SqliteStore] Migrated: added start_time_real column to action_history')
    }

    // Add end_time column
    if (!columnNames.has('end_time')) {
      this.db.prepare('ALTER TABLE action_history ADD COLUMN end_time TEXT').run()
      console.log('[SqliteStore] Migrated: added end_time column to action_history')
    }

    // Add last_update_time column
    if (!columnNames.has('last_update_time')) {
      this.db.prepare('ALTER TABLE action_history ADD COLUMN last_update_time INTEGER').run()
      console.log('[SqliteStore] Migrated: added last_update_time column to action_history')
    }

    // Add stats_snapshot column
    if (!columnNames.has('stats_snapshot')) {
      this.db.prepare('ALTER TABLE action_history ADD COLUMN stats_snapshot TEXT').run()
      console.log('[SqliteStore] Migrated: added stats_snapshot column to action_history')
    }

    // Create partial unique index for in-progress actions (one per character)
    this.db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_action
        ON action_history(character_id)
        WHERE status = 'in_progress'
    `).run()
  }

  async saveState(state: SerializedWorldState): Promise<void> {
    const currentIds = Object.keys(state.characters)

    const transaction = this.db.transaction(() => {
      // Delete characters no longer in state
      this.deleteCharactersNotIn(currentIds)

      // Save all characters
      for (const [id, char] of Object.entries(state.characters)) {
        this.saveCharacterSync(id, char)
      }

      // Save time
      this.saveTimeSync(state.time)

      // Save current map ID
      this.saveCurrentMapIdSync(state.currentMapId)
    })

    transaction()
  }

  private deleteCharactersNotIn(ids: string[]): void {
    if (ids.length === 0) {
      // Delete all characters if none should remain
      this.db.prepare('DELETE FROM character_states').run()
      return
    }

    const placeholders = ids.map(() => '?').join(', ')
    const stmt = this.db.prepare(`DELETE FROM character_states WHERE id NOT IN (${placeholders})`)
    stmt.run(...ids)
  }

  async loadState(): Promise<SerializedWorldState | null> {
    const hasDataResult = await this.hasData()
    if (!hasDataResult) {
      return null
    }

    const characters = await this.loadAllCharacters()
    const time = await this.loadTime()
    const currentMapId = await this.loadCurrentMapId()

    if (!time || !currentMapId) {
      return null
    }

    return {
      characters,
      npcs: {}, // NPCs are not persisted, loaded from config
      currentMapId,
      time,
      isPaused: false,
      transition: {
        isTransitioning: false,
        characterId: null,
        fromMapId: null,
        toMapId: null,
        progress: 0,
      },
      tick: 0,
    }
  }

  async saveCharacter(id: string, character: SimCharacter): Promise<void> {
    this.saveCharacterSync(id, character)
  }

  private saveCharacterSync(id: string, character: SimCharacter): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO character_states (
        id, name, sprite, employment, money, satiety, energy, hygiene, mood, bladder, fitness,
        current_map_id, current_node_id, position_x, position_y, direction, updated_at
      ) VALUES (
        @id, @name, @sprite, @employment, @money, @satiety, @energy, @hygiene, @mood, @bladder, @fitness,
        @current_map_id, @current_node_id, @position_x, @position_y, @direction, @updated_at
      )
    `)

    stmt.run({
      id,
      name: character.name,
      sprite: JSON.stringify(character.sprite),
      employment: character.employment ? JSON.stringify(character.employment) : null,
      money: character.money,
      satiety: round2(character.satiety),
      energy: round2(character.energy),
      hygiene: round2(character.hygiene),
      mood: round2(character.mood),
      bladder: round2(character.bladder),
      fitness: round2(character.fitness),
      current_map_id: character.currentMapId,
      current_node_id: character.currentNodeId,
      position_x: character.position.x,
      position_y: character.position.y,
      direction: character.direction,
      updated_at: Date.now(),
    })
  }

  async loadCharacter(id: string): Promise<SimCharacter | null> {
    const stmt = this.db.prepare('SELECT * FROM character_states WHERE id = ?')
    const row = stmt.get(id) as CharacterRow | undefined

    if (!row) {
      return null
    }

    return this.rowToSimCharacter(row)
  }

  async loadAllCharacters(): Promise<Record<string, SimCharacter>> {
    const stmt = this.db.prepare('SELECT * FROM character_states')
    const rows = stmt.all() as CharacterRow[]

    const result: Record<string, SimCharacter> = {}
    for (const row of rows) {
      result[row.id] = this.rowToSimCharacter(row)
    }
    return result
  }

  private rowToSimCharacter(row: CharacterRow): SimCharacter {
    return {
      id: row.id,
      name: row.name,
      sprite: JSON.parse(row.sprite) as SpriteConfig,
      employment: row.employment ? (JSON.parse(row.employment) as Employment) : undefined,
      money: row.money,
      satiety: row.satiety,
      energy: row.energy,
      hygiene: row.hygiene,
      mood: row.mood,
      bladder: row.bladder,
      fitness: row.fitness,
      currentMapId: row.current_map_id,
      currentNodeId: row.current_node_id,
      position: { x: row.position_x, y: row.position_y },
      direction: row.direction as Direction,
      // Runtime state - initialized to defaults
      navigation: {
        isMoving: false,
        path: [],
        currentPathIndex: 0,
        progress: 0,
        startPosition: null,
        targetPosition: null,
      },
      crossMapNavigation: null,
      conversation: null,
      currentAction: null,
      pendingAction: null,
      actionCounter: 0, // Runtime state - reset on load
      afterSystemAutoAction: false, // Runtime state - reset on load
    }
  }

  async deleteCharacter(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM character_states WHERE id = ?')
    stmt.run(id)
  }

  async saveTime(time: WorldTime): Promise<void> {
    this.saveTimeSync(time)
  }

  private saveTimeSync(time: WorldTime): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO world_time (id, hour, minute, day, updated_at)
      VALUES (1, @hour, @minute, @day, @updated_at)
    `)

    stmt.run({
      hour: time.hour,
      minute: time.minute,
      day: time.day,
      updated_at: Date.now(),
    })
  }

  async loadTime(): Promise<WorldTime | null> {
    const stmt = this.db.prepare('SELECT * FROM world_time WHERE id = 1')
    const row = stmt.get() as WorldTimeRow | undefined

    if (!row) {
      return null
    }

    return {
      hour: row.hour,
      minute: row.minute,
      day: row.day,
    }
  }

  async saveCurrentMapId(mapId: string): Promise<void> {
    this.saveCurrentMapIdSync(mapId)
  }

  private saveCurrentMapIdSync(mapId: string): void {
    this.upsertServerState({ currentMapId: mapId })
  }

  async loadCurrentMapId(): Promise<string | null> {
    const row = this.getServerStateRow()
    return row?.current_map_id ?? null
  }

  async saveServerStartTime(time: number): Promise<void> {
    this.upsertServerState({ serverStartTime: time })
  }

  async loadServerStartTime(): Promise<number | null> {
    const row = this.getServerStateRow()
    return row?.server_start_time ?? null
  }

  // Unified server state upsert - preserves existing values with COALESCE
  private upsertServerState(update: { serverStartTime?: number; currentMapId?: string }): void {
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO server_state (id, server_start_time, current_map_id, updated_at)
      VALUES (
        1,
        COALESCE(@server_start_time, (SELECT server_start_time FROM server_state WHERE id = 1), @fallback_time),
        COALESCE(@current_map_id, (SELECT current_map_id FROM server_state WHERE id = 1), 'home'),
        @updated_at
      )
    `)

    stmt.run({
      server_start_time: update.serverStartTime ?? null,
      current_map_id: update.currentMapId ?? null,
      fallback_time: now,
      updated_at: now,
    })
  }

  private getServerStateRow(): { server_start_time: number; current_map_id: string } | undefined {
    const stmt = this.db.prepare('SELECT server_start_time, current_map_id FROM server_state WHERE id = 1')
    return stmt.get() as { server_start_time: number; current_map_id: string } | undefined
  }

  // Schedule CRUD methods

  async saveSchedule(schedule: DailySchedule): Promise<void> {
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT INTO schedules (character_id, day, entries, created_at, updated_at)
      VALUES (@character_id, @day, @entries, @created_at, @updated_at)
      ON CONFLICT(character_id, day) DO UPDATE SET
        entries = @entries,
        updated_at = @updated_at
    `)

    stmt.run({
      character_id: schedule.characterId,
      day: schedule.day,
      entries: JSON.stringify(schedule.entries),
      created_at: now,
      updated_at: now,
    })
  }

  async loadSchedule(characterId: string, day: number): Promise<DailySchedule | null> {
    const stmt = this.db.prepare('SELECT * FROM schedules WHERE character_id = ? AND day = ?')
    const row = stmt.get(characterId, day) as ScheduleRow | undefined

    if (!row) {
      return null
    }

    return this.rowToSchedule(row)
  }

  async loadSchedulesForCharacter(characterId: string): Promise<DailySchedule[]> {
    const stmt = this.db.prepare('SELECT * FROM schedules WHERE character_id = ? ORDER BY day')
    const rows = stmt.all(characterId) as ScheduleRow[]

    return rows.map(row => this.rowToSchedule(row))
  }

  private rowToSchedule(row: ScheduleRow): DailySchedule {
    return {
      characterId: row.character_id,
      day: row.day,
      entries: JSON.parse(row.entries) as ScheduleEntry[],
    }
  }

  async deleteSchedule(characterId: string, day: number): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM schedules WHERE character_id = ? AND day = ?')
    stmt.run(characterId, day)
  }

  async deleteAllSchedulesForCharacter(characterId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM schedules WHERE character_id = ?')
    stmt.run(characterId)
  }

  // Action history CRUD methods

  async addActionHistory(entry: {
    characterId: string
    day: number
    time: string
    actionId: string
    target?: string
    durationMinutes?: number
    reason?: string
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO action_history (character_id, day, time, action_id, target, duration_minutes, reason, created_at)
      VALUES (@character_id, @day, @time, @action_id, @target, @duration_minutes, @reason, @created_at)
    `)

    stmt.run({
      character_id: entry.characterId,
      day: entry.day,
      time: entry.time,
      action_id: entry.actionId,
      target: entry.target ?? null,
      duration_minutes: entry.durationMinutes ?? null,
      reason: entry.reason ?? null,
      created_at: Date.now(),
    })
  }

  async loadActionHistoryForDay(characterId: string, day: number, limit?: number): Promise<ActionHistoryEntry[]> {
    // Order by time DESC, created_at DESC to get recent first when limit is applied
    const query = limit
      ? 'SELECT * FROM action_history WHERE character_id = ? AND day = ? ORDER BY time DESC, created_at DESC LIMIT ?'
      : 'SELECT * FROM action_history WHERE character_id = ? AND day = ? ORDER BY time DESC, created_at DESC'
    const stmt = this.db.prepare(query)
    const rows = (limit ? stmt.all(characterId, day, limit) : stmt.all(characterId, day)) as ActionHistoryRow[]

    // Reverse to get chronological order (oldest first) after limiting
    return rows.reverse().map(row => ({
      time: row.time,
      actionId: row.action_id,
      target: row.target ?? undefined,
      durationMinutes: row.duration_minutes ?? undefined,
      reason: row.reason ?? undefined,
      episode: row.episode ?? undefined,
    }))
  }

  async updateActionHistoryEpisode(characterId: string, day: number, time: string, episode: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE action_history SET episode = @episode
      WHERE id = (
        SELECT id FROM action_history
        WHERE character_id = @character_id AND day = @day AND time = @time
        ORDER BY id DESC LIMIT 1
      )
    `)
    stmt.run({
      character_id: characterId,
      day,
      time,
      episode,
    })
  }

  // New action persistence methods

  async startActionHistory(entry: {
    characterId: string
    day: number
    time: string
    actionId: string
    target?: string
    durationMinutes?: number
    reason?: string
    startTimeReal: number
  }): Promise<number> {
    const now = Date.now()

    // First, force-complete any existing in_progress action for this character
    // This prevents UNIQUE constraint violation on idx_active_action
    const forceCompleteStmt = this.db.prepare(`
      UPDATE action_history
      SET status = 'aborted', end_time = 'interrupted', last_update_time = @last_update_time
      WHERE character_id = @character_id AND status = 'in_progress'
    `)
    forceCompleteStmt.run({
      character_id: entry.characterId,
      last_update_time: now,
    })

    const stmt = this.db.prepare(`
      INSERT INTO action_history (
        character_id, day, time, action_id, target, duration_minutes, reason,
        status, start_time_real, last_update_time, created_at
      ) VALUES (
        @character_id, @day, @time, @action_id, @target, @duration_minutes, @reason,
        'in_progress', @start_time_real, @last_update_time, @created_at
      )
    `)

    const result = stmt.run({
      character_id: entry.characterId,
      day: entry.day,
      time: entry.time,
      action_id: entry.actionId,
      target: entry.target ?? null,
      duration_minutes: entry.durationMinutes ?? null,
      reason: entry.reason ?? null,
      start_time_real: entry.startTimeReal,
      last_update_time: now,
      created_at: now,
    })

    return Number(result.lastInsertRowid)
  }

  async updateActiveActionProgress(
    rowId: number,
    statsSnapshot: CharacterStats
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE action_history
      SET stats_snapshot = @stats_snapshot, last_update_time = @last_update_time
      WHERE id = @row_id AND status = 'in_progress'
    `)

    stmt.run({
      row_id: rowId,
      stats_snapshot: JSON.stringify(statsSnapshot),
      last_update_time: Date.now(),
    })
  }

  async completeActionHistory(
    rowId: number,
    endTime: string,
    episode?: string
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE action_history
      SET status = 'completed', end_time = @end_time, episode = @episode, last_update_time = @last_update_time
      WHERE id = @row_id
    `)

    stmt.run({
      row_id: rowId,
      end_time: endTime,
      episode: episode ?? null,
      last_update_time: Date.now(),
    })
  }

  async loadActiveActions(): Promise<ActiveActionEntry[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM action_history WHERE status = 'in_progress'
    `)
    const rows = stmt.all() as ActionHistoryRow[]

    return rows.map(row => ({
      rowId: row.id,
      characterId: row.character_id,
      day: row.day,
      time: row.time,
      actionId: row.action_id,
      target: row.target ?? undefined,
      durationMinutes: row.duration_minutes ?? undefined,
      reason: row.reason ?? undefined,
      startTimeReal: row.start_time_real ?? row.created_at,
      lastUpdateTime: row.last_update_time ?? row.created_at,
      statsSnapshot: row.stats_snapshot ? JSON.parse(row.stats_snapshot) as CharacterStats : undefined,
    }))
  }

  // NPC Summary CRUD methods

  async saveNPCSummary(entry: ConversationSummaryEntry): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO npc_summaries (character_id, npc_id, npc_name, goal, summary, topics, goal_achieved, timestamp, day, time, affinity_change, mood, created_at)
      VALUES (@character_id, @npc_id, @npc_name, @goal, @summary, @topics, @goal_achieved, @timestamp, @day, @time, @affinity_change, @mood, @created_at)
    `)

    stmt.run({
      character_id: entry.characterId,
      npc_id: entry.npcId,
      npc_name: entry.npcName,
      goal: entry.goal ?? null,
      summary: entry.summary,
      topics: JSON.stringify(entry.topics),
      goal_achieved: entry.goalAchieved ? 1 : 0,
      timestamp: entry.timestamp,
      day: entry.day ?? null,
      time: entry.time ?? null,
      affinity_change: entry.affinityChange ?? null,
      mood: entry.mood ?? null,
      created_at: Date.now(),
    })
  }

  async loadRecentNPCSummaries(characterId: string, npcId: string, limit: number = 5): Promise<ConversationSummaryEntry[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM npc_summaries WHERE character_id = ? AND npc_id = ? ORDER BY timestamp DESC LIMIT ?'
    )
    const rows = stmt.all(characterId, npcId, limit) as Array<{
      character_id: string
      npc_id: string
      npc_name: string
      goal: string | null
      summary: string
      topics: string
      goal_achieved: number
      timestamp: number
      day: number | null
      time: string | null
      affinity_change: number | null
      mood: string | null
    }>

    return rows.map(row => ({
      characterId: row.character_id,
      npcId: row.npc_id,
      npcName: row.npc_name,
      goal: row.goal ?? undefined,
      summary: row.summary,
      topics: JSON.parse(row.topics) as string[],
      goalAchieved: row.goal_achieved === 1,
      timestamp: row.timestamp,
      day: row.day ?? undefined,
      time: row.time ?? undefined,
      affinityChange: row.affinity_change ?? undefined,
      mood: row.mood ?? undefined,
    }))
  }

  async loadNPCSummariesForDay(day: number): Promise<ConversationSummaryEntry[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM npc_summaries WHERE day = ? ORDER BY time, timestamp'
    )
    const rows = stmt.all(day) as Array<{
      character_id: string
      npc_id: string
      npc_name: string
      goal: string | null
      summary: string
      topics: string
      goal_achieved: number
      timestamp: number
      day: number | null
      time: string | null
      affinity_change: number | null
      mood: string | null
    }>

    return rows.map(row => ({
      characterId: row.character_id,
      npcId: row.npc_id,
      npcName: row.npc_name,
      goal: row.goal ?? undefined,
      summary: row.summary,
      topics: JSON.parse(row.topics) as string[],
      goalAchieved: row.goal_achieved === 1,
      timestamp: row.timestamp,
      day: row.day ?? undefined,
      time: row.time ?? undefined,
      affinityChange: row.affinity_change ?? undefined,
      mood: row.mood ?? undefined,
    }))
  }

  // NPC State CRUD methods

  async saveNPCState(npcId: string, state: NPCDynamicState): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO npc_states (npc_id, affinity, mood, facts, conversation_count, last_conversation, updated_at)
      VALUES (@npc_id, @affinity, @mood, @facts, @conversation_count, @last_conversation, @updated_at)
    `)

    stmt.run({
      npc_id: npcId,
      affinity: state.affinity,
      mood: state.mood,
      facts: JSON.stringify(state.facts),
      conversation_count: state.conversationCount,
      last_conversation: state.lastConversation,
      updated_at: Date.now(),
    })
  }

  async loadNPCState(npcId: string): Promise<NPCDynamicState | null> {
    const stmt = this.db.prepare('SELECT * FROM npc_states WHERE npc_id = ?')
    const row = stmt.get(npcId) as {
      npc_id: string
      affinity: number
      mood: string
      facts: string
      conversation_count: number
      last_conversation: number | null
      updated_at: number
    } | undefined

    if (!row) return null

    return {
      affinity: row.affinity,
      mood: row.mood,
      facts: this.parseNPCFacts(row.facts),
      conversationCount: row.conversation_count,
      lastConversation: row.last_conversation,
    }
  }

  // Parse NPC facts with backward compatibility (string[] -> NPCFact[])
  private parseNPCFacts(factsJson: string): NPCFact[] {
    const parsed = JSON.parse(factsJson)
    if (!Array.isArray(parsed)) return []
    if (parsed.length === 0) return []
    // Check if first element is string (old format) or object (new format)
    if (typeof parsed[0] === 'string') {
      // Old format: convert string[] to NPCFact[] (permanent facts)
      return parsed.map((content: string) => ({ content, expiresDay: null }))
    }
    // New format: already NPCFact[]
    return parsed as NPCFact[]
  }

  async loadAllNPCStates(): Promise<Map<string, NPCDynamicState>> {
    const stmt = this.db.prepare('SELECT * FROM npc_states')
    const rows = stmt.all() as Array<{
      npc_id: string
      affinity: number
      mood: string
      facts: string
      conversation_count: number
      last_conversation: number | null
    }>

    const result = new Map<string, NPCDynamicState>()
    for (const row of rows) {
      result.set(row.npc_id, {
        affinity: row.affinity,
        mood: row.mood,
        facts: this.parseNPCFacts(row.facts),
        conversationCount: row.conversation_count,
        lastConversation: row.last_conversation,
      })
    }
    return result
  }

  // Mid-term memory CRUD methods

  async addMidTermMemory(memory: MidTermMemory): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO mid_term_memories (id, character_id, content, importance, created_day, expires_day, source_npc_id)
      VALUES (@id, @character_id, @content, @importance, @created_day, @expires_day, @source_npc_id)
    `)

    stmt.run({
      id: memory.id,
      character_id: memory.characterId,
      content: memory.content,
      importance: memory.importance,
      created_day: memory.createdDay,
      expires_day: memory.expiresDay,
      source_npc_id: memory.sourceNpcId ?? null,
    })
  }

  async replaceMidTermMemories(characterId: string, memories: MidTermMemory[]): Promise<void> {
    const transaction = this.db.transaction(() => {
      // Delete all existing memories for this character
      this.db.prepare('DELETE FROM mid_term_memories WHERE character_id = ?').run(characterId)

      // Insert new consolidated memories
      const insertStmt = this.db.prepare(`
        INSERT INTO mid_term_memories (id, character_id, content, importance, created_day, expires_day, source_npc_id)
        VALUES (@id, @character_id, @content, @importance, @created_day, @expires_day, @source_npc_id)
      `)

      for (const memory of memories) {
        insertStmt.run({
          id: memory.id,
          character_id: memory.characterId,
          content: memory.content,
          importance: memory.importance,
          created_day: memory.createdDay,
          expires_day: memory.expiresDay,
          source_npc_id: memory.sourceNpcId ?? null,
        })
      }
    })

    transaction()
  }

  async loadActiveMidTermMemories(characterId: string, currentDay: number): Promise<MidTermMemory[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM mid_term_memories WHERE character_id = ? AND expires_day >= ? ORDER BY created_day DESC'
    )
    const rows = stmt.all(characterId, currentDay) as Array<{
      id: string
      character_id: string
      content: string
      importance: string
      created_day: number
      expires_day: number
      source_npc_id: string | null
    }>

    return rows.map(row => ({
      id: row.id,
      characterId: row.character_id,
      content: row.content,
      importance: row.importance as 'low' | 'medium' | 'high',
      createdDay: row.created_day,
      expiresDay: row.expires_day,
      sourceNpcId: row.source_npc_id ?? undefined,
    }))
  }

  async deleteExpiredMidTermMemories(currentDay: number): Promise<number> {
    const stmt = this.db.prepare('DELETE FROM mid_term_memories WHERE expires_day < ?')
    const result = stmt.run(currentDay)
    return result.changes
  }

  async hasData(): Promise<boolean> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM character_states')
    const result = stmt.get() as { count: number }
    return result.count > 0
  }

  async clear(): Promise<void> {
    this.db.exec(`
      DELETE FROM character_states;
      DELETE FROM world_time;
      DELETE FROM server_state;
      DELETE FROM schedules;
      DELETE FROM action_history;
      DELETE FROM npc_summaries;
      DELETE FROM npc_states;
      DELETE FROM mid_term_memories;
      DELETE FROM debug_logs;
    `)
  }

  // Debug log CRUD methods

  async addDebugLog(entry: {
    type: 'llm_behavior' | 'conversation_turn'
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO debug_logs (type, character_id, day, time, data, created_at)
      VALUES (@type, @character_id, @day, @time, @data, @created_at)
    `)

    stmt.run({
      type: entry.type,
      character_id: entry.characterId,
      day: entry.day,
      time: entry.time,
      data: JSON.stringify(entry.data),
      created_at: Date.now(),
    })
  }

  async loadDebugLogsForDay(day: number): Promise<Array<{
    id: number
    type: string
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
    createdAt: number
  }>> {
    const stmt = this.db.prepare(
      'SELECT * FROM debug_logs WHERE day = ? ORDER BY time, created_at'
    )
    const rows = stmt.all(day) as Array<{
      id: number
      type: string
      character_id: string
      day: number
      time: string
      data: string
      created_at: number
    }>

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      characterId: row.character_id,
      day: row.day,
      time: row.time,
      data: JSON.parse(row.data) as Record<string, unknown>,
      createdAt: row.created_at,
    }))
  }

  async loadDebugLogsForCharacter(characterId: string, day?: number): Promise<Array<{
    id: number
    type: string
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
    createdAt: number
  }>> {
    const query = day !== undefined
      ? 'SELECT * FROM debug_logs WHERE character_id = ? AND day = ? ORDER BY time, created_at'
      : 'SELECT * FROM debug_logs WHERE character_id = ? ORDER BY day DESC, time DESC, created_at DESC LIMIT 100'

    const stmt = this.db.prepare(query)
    const rows = (day !== undefined ? stmt.all(characterId, day) : stmt.all(characterId)) as Array<{
      id: number
      type: string
      character_id: string
      day: number
      time: string
      data: string
      created_at: number
    }>

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      characterId: row.character_id,
      day: row.day,
      time: row.time,
      data: JSON.parse(row.data) as Record<string, unknown>,
      createdAt: row.created_at,
    }))
  }

  async deleteOldDebugLogs(keepDays: number): Promise<number> {
    // keepDays 日より古いログを削除
    const stmt = this.db.prepare('DELETE FROM debug_logs WHERE day < ?')
    const result = stmt.run(keepDays)
    return result.changes
  }

  // ==========================================================================
  // Chat message methods
  // ==========================================================================

  async saveChatMessage(message: ChatMessageRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO chat_messages (
        provider_id, channel_id, channel_name, message_id, sender_id, sender_name,
        content, is_from_character, character_id, timestamp, created_at
      ) VALUES (
        @provider_id, @channel_id, @channel_name, @message_id, @sender_id, @sender_name,
        @content, @is_from_character, @character_id, @timestamp, @created_at
      )
    `)

    stmt.run({
      provider_id: message.providerId,
      channel_id: message.channelId,
      channel_name: message.channelName,
      message_id: message.messageId,
      sender_id: message.senderId,
      sender_name: message.senderName,
      content: message.content,
      is_from_character: message.isFromCharacter ? 1 : 0,
      character_id: message.characterId ?? null,
      timestamp: message.timestamp,
      created_at: message.createdAt,
    })
  }

  async loadRecentChatMessages(
    providerId: ChatProviderId,
    channelId: string,
    limit: number = 10
  ): Promise<ChatMessageRecord[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM chat_messages
      WHERE provider_id = ? AND channel_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    const rows = stmt.all(providerId, channelId, limit) as Array<{
      id: number
      provider_id: string
      channel_id: string
      channel_name: string
      message_id: string
      sender_id: string
      sender_name: string
      content: string
      is_from_character: number
      character_id: string | null
      timestamp: number
      created_at: number
    }>

    // Reverse to get chronological order (oldest first)
    return rows.reverse().map(row => ({
      id: row.id,
      providerId: row.provider_id as ChatProviderId,
      channelId: row.channel_id,
      channelName: row.channel_name,
      messageId: row.message_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      content: row.content,
      isFromCharacter: row.is_from_character === 1,
      characterId: row.character_id ?? undefined,
      timestamp: row.timestamp,
      createdAt: row.created_at,
    }))
  }

  async deleteOldChatMessages(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const stmt = this.db.prepare('DELETE FROM chat_messages WHERE created_at < ?')
    const result = stmt.run(cutoff)
    return result.changes
  }

  // ==========================================================================
  // Chat summary methods
  // ==========================================================================

  async saveChatSummary(summary: ChatSummary): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO chat_summaries (
        character_id, provider_id, channel_id, channel_name, summary,
        last_interaction_at, total_messages, updated_at
      ) VALUES (
        @character_id, @provider_id, @channel_id, @channel_name, @summary,
        @last_interaction_at, @total_messages, @updated_at
      )
      ON CONFLICT(character_id, provider_id, channel_id) DO UPDATE SET
        channel_name = @channel_name,
        summary = @summary,
        last_interaction_at = @last_interaction_at,
        total_messages = @total_messages,
        updated_at = @updated_at
    `)

    stmt.run({
      character_id: summary.characterId,
      provider_id: summary.providerId,
      channel_id: summary.channelId,
      channel_name: summary.channelName,
      summary: summary.summary,
      last_interaction_at: summary.lastInteractionAt,
      total_messages: summary.totalMessages,
      updated_at: summary.updatedAt,
    })
  }

  async loadChatSummary(
    characterId: string,
    providerId: ChatProviderId,
    channelId: string
  ): Promise<ChatSummary | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM chat_summaries
      WHERE character_id = ? AND provider_id = ? AND channel_id = ?
    `)
    const row = stmt.get(characterId, providerId, channelId) as {
      character_id: string
      provider_id: string
      channel_id: string
      channel_name: string
      summary: string
      last_interaction_at: number
      total_messages: number
      updated_at: number
    } | undefined

    if (!row) return null

    return {
      characterId: row.character_id,
      providerId: row.provider_id as ChatProviderId,
      channelId: row.channel_id,
      channelName: row.channel_name,
      summary: row.summary,
      lastInteractionAt: row.last_interaction_at,
      totalMessages: row.total_messages,
      updatedAt: row.updated_at,
    }
  }

  async loadChatSummariesForCharacter(characterId: string): Promise<ChatSummary[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM chat_summaries
      WHERE character_id = ?
      ORDER BY last_interaction_at DESC
    `)
    const rows = stmt.all(characterId) as Array<{
      character_id: string
      provider_id: string
      channel_id: string
      channel_name: string
      summary: string
      last_interaction_at: number
      total_messages: number
      updated_at: number
    }>

    return rows.map(row => ({
      characterId: row.character_id,
      providerId: row.provider_id as ChatProviderId,
      channelId: row.channel_id,
      channelName: row.channel_name,
      summary: row.summary,
      lastInteractionAt: row.last_interaction_at,
      totalMessages: row.total_messages,
      updatedAt: row.updated_at,
    }))
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

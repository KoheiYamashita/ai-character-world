import Database from 'better-sqlite3'
import type { StateStore } from './StateStore'
import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, Direction, SpriteConfig, Employment } from '@/types'
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
  hunger: number
  energy: number
  hygiene: number
  mood: number
  bladder: number
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
        hunger INTEGER NOT NULL,
        energy INTEGER NOT NULL,
        hygiene INTEGER NOT NULL,
        mood INTEGER NOT NULL,
        bladder INTEGER NOT NULL,
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
    `)
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
        id, name, sprite, employment, money, hunger, energy, hygiene, mood, bladder,
        current_map_id, current_node_id, position_x, position_y, direction, updated_at
      ) VALUES (
        @id, @name, @sprite, @employment, @money, @hunger, @energy, @hygiene, @mood, @bladder,
        @current_map_id, @current_node_id, @position_x, @position_y, @direction, @updated_at
      )
    `)

    stmt.run({
      id,
      name: character.name,
      sprite: JSON.stringify(character.sprite),
      employment: character.employment ? JSON.stringify(character.employment) : null,
      money: character.money,
      hunger: round2(character.hunger),
      energy: round2(character.energy),
      hygiene: round2(character.hygiene),
      mood: round2(character.mood),
      bladder: round2(character.bladder),
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
      hunger: row.hunger,
      energy: row.energy,
      hygiene: row.hygiene,
      mood: row.mood,
      bladder: row.bladder,
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
        COALESCE(@current_map_id, (SELECT current_map_id FROM server_state WHERE id = 1), 'town'),
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
    `)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

/**
 * Step 11: スケジュールCRUDテストスクリプト
 *
 * 実行: node scripts/test-schedule-crud.mjs
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

const DB_PATH = 'data/test-schedule.db'

// テスト用のスケジュールデータ
const testSchedule1 = {
  characterId: 'kanon',
  day: 1,
  entries: [
    { time: '07:00', activity: '起床' },
    { time: '09:00', activity: '仕事', location: '書斎' },
    { time: '23:00', activity: '就寝', location: 'bedroom' }
  ]
}

const testSchedule2 = {
  characterId: 'kanon',
  day: 2,
  entries: [
    { time: '08:00', activity: '起床' },
    { time: '10:00', activity: '買い物', location: 'town' },
    { time: '22:00', activity: '就寝', location: 'bedroom' }
  ]
}

const testSchedule3 = {
  characterId: 'other-character',
  day: 1,
  entries: [
    { time: '06:00', activity: '起床' }
  ]
}

function cleanup() {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH)
  }
}

function initDb() {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')

  // SQLiteのexec()はシェルコマンドではなくSQLを実行するメソッド
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      entries TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(character_id, day)
    );

    CREATE INDEX IF NOT EXISTS idx_schedules_character_day
      ON schedules(character_id, day);
  `)

  return db
}

// CRUD操作
function saveSchedule(db, schedule) {
  const now = Date.now()
  const stmt = db.prepare(`
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

function loadSchedule(db, characterId, day) {
  const stmt = db.prepare('SELECT * FROM schedules WHERE character_id = ? AND day = ?')
  const row = stmt.get(characterId, day)

  if (!row) return null

  return {
    characterId: row.character_id,
    day: row.day,
    entries: JSON.parse(row.entries)
  }
}

function loadSchedulesForCharacter(db, characterId) {
  const stmt = db.prepare('SELECT * FROM schedules WHERE character_id = ? ORDER BY day')
  const rows = stmt.all(characterId)

  return rows.map(row => ({
    characterId: row.character_id,
    day: row.day,
    entries: JSON.parse(row.entries)
  }))
}

function deleteSchedule(db, characterId, day) {
  const stmt = db.prepare('DELETE FROM schedules WHERE character_id = ? AND day = ?')
  stmt.run(characterId, day)
}

function deleteAllSchedulesForCharacter(db, characterId) {
  const stmt = db.prepare('DELETE FROM schedules WHERE character_id = ?')
  stmt.run(characterId)
}

// テスト実行
function runTests() {
  console.log('=== Step 11: スケジュールCRUDテスト ===\n')

  cleanup()
  const db = initDb()

  let passed = 0
  let failed = 0

  // Test 1: スケジュール保存
  console.log('Test 1: saveSchedule')
  try {
    saveSchedule(db, testSchedule1)
    saveSchedule(db, testSchedule2)
    saveSchedule(db, testSchedule3)
    console.log('  OK: 3件のスケジュールを保存\n')
    passed++
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  // Test 2: スケジュール取得
  console.log('Test 2: loadSchedule')
  try {
    const loaded = loadSchedule(db, 'kanon', 1)
    if (loaded && loaded.characterId === 'kanon' && loaded.day === 1 && loaded.entries.length === 3) {
      console.log('  OK: kanon day=1 を取得')
      console.log('    entries:', JSON.stringify(loaded.entries))
      console.log()
      passed++
    } else {
      throw new Error('取得データが不正')
    }
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  // Test 3: 存在しないスケジュール取得
  console.log('Test 3: loadSchedule (存在しない)')
  try {
    const loaded = loadSchedule(db, 'kanon', 999)
    if (loaded === null) {
      console.log('  OK: 存在しないスケジュールはnullを返す\n')
      passed++
    } else {
      throw new Error('nullが返されるべき')
    }
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  // Test 4: キャラクターの全スケジュール取得
  console.log('Test 4: loadSchedulesForCharacter')
  try {
    const schedules = loadSchedulesForCharacter(db, 'kanon')
    if (schedules.length === 2 && schedules[0].day === 1 && schedules[1].day === 2) {
      console.log('  OK: kanonの全スケジュール(2件)を取得、day順にソート')
      console.log('    day 1:', schedules[0].entries.length, 'entries')
      console.log('    day 2:', schedules[1].entries.length, 'entries')
      console.log()
      passed++
    } else {
      throw new Error('取得データが不正')
    }
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  // Test 5: UPSERT (既存スケジュールの更新)
  console.log('Test 5: saveSchedule (UPSERT)')
  try {
    const updated = {
      characterId: 'kanon',
      day: 1,
      entries: [
        { time: '06:00', activity: '早起き' },
        { time: '22:00', activity: '早寝', location: 'bedroom' }
      ]
    }
    saveSchedule(db, updated)
    const loaded = loadSchedule(db, 'kanon', 1)
    if (loaded && loaded.entries.length === 2 && loaded.entries[0].activity === '早起き') {
      console.log('  OK: 既存スケジュールを更新')
      console.log('    新entries:', JSON.stringify(loaded.entries))
      console.log()
      passed++
    } else {
      throw new Error('更新が反映されていない')
    }
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  // Test 6: スケジュール削除
  console.log('Test 6: deleteSchedule')
  try {
    deleteSchedule(db, 'kanon', 2)
    const loaded = loadSchedule(db, 'kanon', 2)
    if (loaded === null) {
      console.log('  OK: kanon day=2 を削除\n')
      passed++
    } else {
      throw new Error('削除されていない')
    }
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  // Test 7: キャラクターの全スケジュール削除
  console.log('Test 7: deleteAllSchedulesForCharacter')
  try {
    // まずkanonにスケジュールを追加し直す
    saveSchedule(db, testSchedule2)

    deleteAllSchedulesForCharacter(db, 'kanon')
    const schedules = loadSchedulesForCharacter(db, 'kanon')
    const otherSchedule = loadSchedule(db, 'other-character', 1)

    if (schedules.length === 0 && otherSchedule !== null) {
      console.log('  OK: kanonの全スケジュールを削除、他キャラクターは影響なし\n')
      passed++
    } else {
      throw new Error('削除が不完全または他キャラクターに影響')
    }
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  // Test 8: UNIQUE制約の確認
  console.log('Test 8: UNIQUE制約 (character_id, day)')
  try {
    // 同じcharacter_id + dayで2回保存してもエラーにならない（UPSERT）
    saveSchedule(db, testSchedule1)
    saveSchedule(db, testSchedule1) // 同じものを再度保存
    const count = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE character_id = ? AND day = ?')
      .get('kanon', 1)
    if (count.count === 1) {
      console.log('  OK: UNIQUE制約によりレコードは1件のみ\n')
      passed++
    } else {
      throw new Error(`重複レコードが作成された: ${count.count}件`)
    }
  } catch (e) {
    console.log('  FAILED:', e.message, '\n')
    failed++
  }

  db.close()
  cleanup()

  // 結果サマリー
  console.log('=== テスト結果 ===')
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${passed + failed}`)

  if (failed > 0) {
    process.exit(1)
  }
}

// characters.json の defaultSchedule 読み込みテスト
function testDefaultScheduleLoad() {
  console.log('\n=== defaultSchedule 読み込みテスト ===\n')

  try {
    const data = JSON.parse(fs.readFileSync('public/data/characters.json', 'utf-8'))
    const kanon = data.characters.find(c => c.id === 'kanon')

    if (!kanon) {
      console.log('FAILED: kanonキャラクターが見つからない')
      return false
    }

    if (!kanon.defaultSchedule) {
      console.log('FAILED: defaultScheduleが見つからない')
      return false
    }

    console.log('OK: defaultScheduleを読み込み')
    console.log(`  エントリ数: ${kanon.defaultSchedule.length}`)
    console.log('  スケジュール:')
    for (const entry of kanon.defaultSchedule) {
      const location = entry.location ? ` (${entry.location})` : ''
      console.log(`    ${entry.time} - ${entry.activity}${location}`)
    }

    // バリデーション
    const hasAllRequiredFields = kanon.defaultSchedule.every(e => e.time && e.activity)
    if (hasAllRequiredFields) {
      console.log('\nOK: 全エントリにtime, activityが存在')
    } else {
      console.log('\nFAILED: 必須フィールドが欠けているエントリあり')
      return false
    }

    return true
  } catch (e) {
    console.log('FAILED:', e.message)
    return false
  }
}

// 実行
runTests()
testDefaultScheduleLoad()

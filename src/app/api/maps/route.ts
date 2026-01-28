/**
 * マップデータ API Route
 * GET: maps.json 読み込み
 * PUT: maps.json 書き込み（バックアップ付き）
 */

import { NextResponse } from 'next/server'
import { readFile, writeFile, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { MapsDataJson } from '@/types'

const MAPS_PATH = join(process.cwd(), 'public/data/maps.json')
const BACKUP_PATH = join(process.cwd(), 'public/data/maps.backup.json')

export async function GET(): Promise<Response> {
  try {
    const content = await readFile(MAPS_PATH, 'utf-8')
    const data = JSON.parse(content) as MapsDataJson
    return NextResponse.json(data)
  } catch (error) {
    console.error('[API maps] Failed to read maps.json:', error)
    return NextResponse.json({ error: 'Failed to read maps.json' }, { status: 500 })
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const data = (await request.json()) as MapsDataJson

    // Validate basic structure
    if (!data.maps || !Array.isArray(data.maps)) {
      return NextResponse.json({ error: 'Invalid data: maps array required' }, { status: 400 })
    }

    // Create backup if original exists
    if (existsSync(MAPS_PATH)) {
      await copyFile(MAPS_PATH, BACKUP_PATH)
    }

    // Write new data with pretty formatting
    const content = JSON.stringify(data, null, 2)
    await writeFile(MAPS_PATH, content, 'utf-8')

    return NextResponse.json({ success: true, message: 'Maps saved successfully' })
  } catch (error) {
    console.error('[API maps] Failed to write maps.json:', error)
    return NextResponse.json({ error: 'Failed to write maps.json' }, { status: 500 })
  }
}

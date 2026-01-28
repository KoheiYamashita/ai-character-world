/**
 * マップバリデーション API Route
 * POST: マップデータのバリデーション実行
 */

import { NextResponse } from 'next/server'
import type { MapConfigJson, ValidationResult } from '@/types'
import { validateMaps, validateEntranceConnections } from '@/lib/mapValidator'

interface ValidateRequest {
  maps: MapConfigJson[]
}

export async function POST(request: Request): Promise<Response> {
  try {
    const data = (await request.json()) as ValidateRequest

    // Validate request structure
    if (!data.maps || !Array.isArray(data.maps)) {
      return NextResponse.json({ error: 'Invalid request: maps array required' }, { status: 400 })
    }

    // Run validation
    const result = validateMaps(data.maps)

    // Also check entrance connections across maps
    const connectionErrors = validateEntranceConnections(data.maps)
    if (connectionErrors.length > 0) {
      result.valid = false
      // Add connection errors to the first map's errors or create a synthetic result
      if (result.results.length > 0) {
        result.results[0].errors.push(...connectionErrors)
        result.results[0].valid = result.results[0].errors.length === 0
      } else {
        result.results.push({
          mapId: '_connections',
          mapName: 'マップ間接続',
          valid: false,
          errors: connectionErrors,
          warnings: [],
        })
      }
    }

    return NextResponse.json(result satisfies ValidationResult)
  } catch (error) {
    console.error('[API maps/validate] Validation failed:', error)
    return NextResponse.json({ error: 'Validation failed' }, { status: 500 })
  }
}

/**
 * 時刻関連のユーティリティ関数
 */

import type { WorldTime } from '@/types'

/**
 * WorldTime を "HH:MM" 形式の文字列にフォーマット
 */
export function formatTime(time: WorldTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

/**
 * "HH:MM" 形式の文字列を WorldTime にパース
 * 無効な形式の場合は null を返す
 */
export function parseTimeString(timeStr: string): { hour: number; minute: number } | null {
  const parts = timeStr.split(':')
  if (parts.length !== 2) return null

  const hour = parseInt(parts[0], 10)
  const minute = parseInt(parts[1], 10)

  if (isNaN(hour) || isNaN(minute)) return null
  if (hour < 0 || hour > 23) return null
  if (minute < 0 || minute > 59) return null

  return { hour, minute }
}

/**
 * WorldTime を分単位に変換（0:00 = 0, 23:59 = 1439）
 */
export function timeToMinutes(time: WorldTime): number {
  return time.hour * 60 + time.minute
}

/**
 * 分単位から時刻に変換
 */
export function minutesToTime(minutes: number): { hour: number; minute: number } {
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440 // 0-1439 に正規化
  return {
    hour: Math.floor(normalizedMinutes / 60),
    minute: normalizedMinutes % 60,
  }
}

/**
 * 2つの時刻を比較
 * @returns 負: a < b, 0: a == b, 正: a > b
 */
export function compareTime(a: WorldTime, b: WorldTime): number {
  const aMinutes = timeToMinutes(a)
  const bMinutes = timeToMinutes(b)
  return aMinutes - bMinutes
}

/**
 * 時刻が指定範囲内かどうかを判定
 * 日をまたぐ範囲（例: 22:00-06:00）にも対応
 */
export function isTimeInRange(
  time: WorldTime,
  start: { hour: number; minute: number },
  end: { hour: number; minute: number }
): boolean {
  const t = timeToMinutes(time)
  const s = start.hour * 60 + start.minute
  const e = end.hour * 60 + end.minute

  if (s <= e) {
    // 通常の範囲（例: 08:00-18:00）
    return t >= s && t <= e
  } else {
    // 日をまたぐ範囲（例: 22:00-06:00）
    return t >= s || t <= e
  }
}

/**
 * 時刻に分を加算
 */
export function addMinutes(
  time: WorldTime,
  minutes: number
): WorldTime {
  let newMinute = time.minute + minutes
  let newHour = time.hour
  let newDay = time.day

  while (newMinute >= 60) {
    newMinute -= 60
    newHour++
  }

  while (newMinute < 0) {
    newMinute += 60
    newHour--
  }

  while (newHour >= 24) {
    newHour -= 24
    newDay++
  }

  while (newHour < 0) {
    newHour += 24
    newDay--
  }

  return { hour: newHour, minute: newMinute, day: newDay }
}

/**
 * デフォルトの初期時刻
 */
export const DEFAULT_INITIAL_TIME: WorldTime = { hour: 8, minute: 0, day: 1 }

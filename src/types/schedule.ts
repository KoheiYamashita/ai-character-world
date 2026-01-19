export interface ScheduleEntry {
  time: string           // "09:00" (HH:MM形式)
  activity: string       // "仕事", "昼食" など
  location?: string      // 場所（任意）
  note?: string          // 備考（任意）
}

export interface DailySchedule {
  characterId: string    // キャラクターID
  day: number            // ワールド日数 (WorldTime.day)
  entries: ScheduleEntry[]
}

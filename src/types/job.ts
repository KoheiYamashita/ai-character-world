// 施設に紐づく仕事情報
export interface JobInfo {
  jobId: string
  title: string            // "フリーライター", "ウェイター"
  hourlyWage: number       // 時給
  workHours: {             // 営業時間（この時間内のみ働ける）
    start: number          // 0-23
    end: number            // 0-23
  }
}

// キャラクターの雇用状態（勤務先を示す）
export interface Employment {
  jobId: string
  workplaceLabel: string   // Zone/建物のラベル（"書斎"）
  mapId: string            // 勤務地マップID（"home"）
}

/**
 * カスタムエラークラス
 * アプリケーション全体で一貫したエラーハンドリングを実現
 */

// 基底エラークラス
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// マップ関連エラー
export class MapLoadError extends AppError {
  constructor(
    public readonly mapId: string,
    message: string,
    cause?: Error
  ) {
    super(message, 'MAP_LOAD_ERROR', cause)
    this.name = 'MapLoadError'
  }
}

// キャラクター関連エラー
export class CharacterLoadError extends AppError {
  constructor(
    public readonly characterId: string,
    message: string,
    cause?: Error
  ) {
    super(message, 'CHARACTER_LOAD_ERROR', cause)
    this.name = 'CharacterLoadError'
  }
}

// 設定関連エラー
export class ConfigLoadError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIG_LOAD_ERROR', cause)
    this.name = 'ConfigLoadError'
  }
}

// シミュレーション関連エラー
export class SimulationError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'SIMULATION_ERROR', cause)
    this.name = 'SimulationError'
  }
}

// アクション実行エラー
export class ActionExecutionError extends AppError {
  constructor(
    public readonly actionId: string,
    public readonly characterId: string,
    message: string,
    cause?: Error
  ) {
    super(message, 'ACTION_EXECUTION_ERROR', cause)
    this.name = 'ActionExecutionError'
  }
}

// LLM関連エラー
export class LLMError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'LLM_ERROR', cause)
    this.name = 'LLMError'
  }
}

// 永続化エラー
export class PersistenceError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'PERSISTENCE_ERROR', cause)
    this.name = 'PersistenceError'
  }
}

// バリデーションエラー
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly field?: string,
    cause?: Error
  ) {
    super(message, 'VALIDATION_ERROR', cause)
    this.name = 'ValidationError'
  }
}

/**
 * エラーがAppErrorかどうかを判定
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * unknownエラーをAppErrorに変換
 */
export function toAppError(error: unknown, defaultMessage = 'Unknown error'): AppError {
  if (error instanceof AppError) {
    return error
  }
  if (error instanceof Error) {
    return new AppError(error.message, 'UNKNOWN_ERROR', error)
  }
  return new AppError(defaultMessage, 'UNKNOWN_ERROR')
}

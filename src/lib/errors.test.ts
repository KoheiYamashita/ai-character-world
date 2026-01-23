import { describe, it, expect } from 'vitest'
import {
  AppError,
  MapLoadError,
  CharacterLoadError,
  ConfigLoadError,
  SimulationError,
  ActionExecutionError,
  LLMError,
  PersistenceError,
  ValidationError,
  isAppError,
  toAppError,
} from './errors'

describe('errors', () => {
  describe('AppError', () => {
    it('should set message, code, and name', () => {
      const err = new AppError('test message', 'TEST_CODE')
      expect(err.message).toBe('test message')
      expect(err.code).toBe('TEST_CODE')
      expect(err.name).toBe('AppError')
    })

    it('should store cause', () => {
      const cause = new Error('original')
      const err = new AppError('wrapped', 'WRAP', cause)
      expect(err.cause).toBe(cause)
    })

    it('should be instanceof Error', () => {
      const err = new AppError('msg', 'CODE')
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('MapLoadError', () => {
    it('should store mapId and set correct code/name', () => {
      const err = new MapLoadError('map1', 'failed to load')
      expect(err.mapId).toBe('map1')
      expect(err.code).toBe('MAP_LOAD_ERROR')
      expect(err.name).toBe('MapLoadError')
      expect(err).toBeInstanceOf(AppError)
    })

    it('should store cause', () => {
      const cause = new Error('io error')
      const err = new MapLoadError('map2', 'failed', cause)
      expect(err.cause).toBe(cause)
    })
  })

  describe('CharacterLoadError', () => {
    it('should store characterId and set correct code/name', () => {
      const err = new CharacterLoadError('char1', 'not found')
      expect(err.characterId).toBe('char1')
      expect(err.code).toBe('CHARACTER_LOAD_ERROR')
      expect(err.name).toBe('CharacterLoadError')
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('ConfigLoadError', () => {
    it('should set correct code/name', () => {
      const err = new ConfigLoadError('bad config')
      expect(err.code).toBe('CONFIG_LOAD_ERROR')
      expect(err.name).toBe('ConfigLoadError')
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('SimulationError', () => {
    it('should set correct code/name', () => {
      const err = new SimulationError('sim failed')
      expect(err.code).toBe('SIMULATION_ERROR')
      expect(err.name).toBe('SimulationError')
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('ActionExecutionError', () => {
    it('should store actionId and characterId', () => {
      const err = new ActionExecutionError('eat', 'char1', 'no food')
      expect(err.actionId).toBe('eat')
      expect(err.characterId).toBe('char1')
      expect(err.code).toBe('ACTION_EXECUTION_ERROR')
      expect(err.name).toBe('ActionExecutionError')
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('LLMError', () => {
    it('should set correct code/name', () => {
      const err = new LLMError('api timeout')
      expect(err.code).toBe('LLM_ERROR')
      expect(err.name).toBe('LLMError')
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('PersistenceError', () => {
    it('should set correct code/name', () => {
      const err = new PersistenceError('db error')
      expect(err.code).toBe('PERSISTENCE_ERROR')
      expect(err.name).toBe('PersistenceError')
      expect(err).toBeInstanceOf(AppError)
    })
  })

  describe('ValidationError', () => {
    it('should set correct code/name and optional field', () => {
      const err = new ValidationError('invalid value', 'email')
      expect(err.code).toBe('VALIDATION_ERROR')
      expect(err.name).toBe('ValidationError')
      expect(err.field).toBe('email')
      expect(err).toBeInstanceOf(AppError)
    })

    it('should allow field to be omitted', () => {
      const err = new ValidationError('invalid')
      expect(err.field).toBeUndefined()
    })
  })

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      expect(isAppError(new AppError('msg', 'CODE'))).toBe(true)
      expect(isAppError(new MapLoadError('m', 'msg'))).toBe(true)
      expect(isAppError(new LLMError('msg'))).toBe(true)
    })

    it('should return false for non-AppError values', () => {
      expect(isAppError(new Error('msg'))).toBe(false)
      expect(isAppError('string')).toBe(false)
      expect(isAppError(null)).toBe(false)
      expect(isAppError(undefined)).toBe(false)
      expect(isAppError(42)).toBe(false)
    })
  })

  describe('toAppError', () => {
    it('should return AppError as-is', () => {
      const err = new LLMError('test')
      expect(toAppError(err)).toBe(err)
    })

    it('should wrap Error in AppError with UNKNOWN_ERROR code', () => {
      const err = new Error('original')
      const result = toAppError(err)
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toBe('original')
      expect(result.code).toBe('UNKNOWN_ERROR')
      expect(result.cause).toBe(err)
    })

    it('should create AppError with default message for non-Error values', () => {
      const result = toAppError('some string')
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toBe('Unknown error')
      expect(result.code).toBe('UNKNOWN_ERROR')
    })

    it('should use custom default message', () => {
      const result = toAppError(null, 'custom default')
      expect(result.message).toBe('custom default')
    })
  })
})

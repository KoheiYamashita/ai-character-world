import { describe, it, expect } from 'vitest'
import {
  formatTime,
  parseTimeString,
  timeToMinutes,
  minutesToTime,
  compareTime,
  isTimeInRange,
  addMinutes,
  DEFAULT_INITIAL_TIME,
} from './timeUtils'

describe('timeUtils', () => {
  describe('formatTime', () => {
    it('should zero-pad single digit hours and minutes', () => {
      expect(formatTime({ hour: 8, minute: 5, day: 1 })).toBe('08:05')
    })

    it('should format two-digit hours and minutes', () => {
      expect(formatTime({ hour: 23, minute: 59, day: 1 })).toBe('23:59')
    })

    it('should format midnight', () => {
      expect(formatTime({ hour: 0, minute: 0, day: 1 })).toBe('00:00')
    })
  })

  describe('parseTimeString', () => {
    it('should parse valid time string', () => {
      expect(parseTimeString('08:30')).toEqual({ hour: 8, minute: 30 })
      expect(parseTimeString('23:59')).toEqual({ hour: 23, minute: 59 })
      expect(parseTimeString('00:00')).toEqual({ hour: 0, minute: 0 })
    })

    it('should return null for invalid format', () => {
      expect(parseTimeString('invalid')).toBeNull()
      expect(parseTimeString('8')).toBeNull()
      expect(parseTimeString('08:30:00')).toBeNull()
      expect(parseTimeString('')).toBeNull()
    })

    it('should return null for non-numeric parts', () => {
      expect(parseTimeString('ab:cd')).toBeNull()
    })

    it('should return null for out-of-range hours', () => {
      expect(parseTimeString('24:00')).toBeNull()
      expect(parseTimeString('-1:00')).toBeNull()
    })

    it('should return null for out-of-range minutes', () => {
      expect(parseTimeString('12:60')).toBeNull()
      expect(parseTimeString('12:-1')).toBeNull()
    })
  })

  describe('timeToMinutes', () => {
    it('should convert time to total minutes', () => {
      expect(timeToMinutes({ hour: 0, minute: 0, day: 1 })).toBe(0)
      expect(timeToMinutes({ hour: 1, minute: 30, day: 1 })).toBe(90)
      expect(timeToMinutes({ hour: 23, minute: 59, day: 1 })).toBe(1439)
    })
  })

  describe('minutesToTime', () => {
    it('should convert minutes to hour/minute', () => {
      expect(minutesToTime(0)).toEqual({ hour: 0, minute: 0 })
      expect(minutesToTime(90)).toEqual({ hour: 1, minute: 30 })
      expect(minutesToTime(1439)).toEqual({ hour: 23, minute: 59 })
    })

    it('should normalize values over 1440', () => {
      expect(minutesToTime(1440)).toEqual({ hour: 0, minute: 0 })
      expect(minutesToTime(1500)).toEqual({ hour: 1, minute: 0 })
    })

    it('should normalize negative values', () => {
      expect(minutesToTime(-60)).toEqual({ hour: 23, minute: 0 })
      expect(minutesToTime(-1)).toEqual({ hour: 23, minute: 59 })
    })
  })

  describe('compareTime', () => {
    it('should return negative when a < b', () => {
      expect(compareTime({ hour: 8, minute: 0, day: 1 }, { hour: 9, minute: 0, day: 1 })).toBeLessThan(0)
    })

    it('should return positive when a > b', () => {
      expect(compareTime({ hour: 10, minute: 0, day: 1 }, { hour: 9, minute: 0, day: 1 })).toBeGreaterThan(0)
    })

    it('should return 0 when equal', () => {
      expect(compareTime({ hour: 8, minute: 30, day: 1 }, { hour: 8, minute: 30, day: 1 })).toBe(0)
    })
  })

  describe('isTimeInRange', () => {
    it('should detect time in normal range', () => {
      const time = { hour: 12, minute: 0, day: 1 }
      expect(isTimeInRange(time, { hour: 8, minute: 0 }, { hour: 18, minute: 0 })).toBe(true)
    })

    it('should detect time outside normal range', () => {
      const time = { hour: 20, minute: 0, day: 1 }
      expect(isTimeInRange(time, { hour: 8, minute: 0 }, { hour: 18, minute: 0 })).toBe(false)
    })

    it('should handle boundary values (inclusive)', () => {
      expect(isTimeInRange(
        { hour: 8, minute: 0, day: 1 },
        { hour: 8, minute: 0 },
        { hour: 18, minute: 0 }
      )).toBe(true)
      expect(isTimeInRange(
        { hour: 18, minute: 0, day: 1 },
        { hour: 8, minute: 0 },
        { hour: 18, minute: 0 }
      )).toBe(true)
    })

    it('should handle overnight range (e.g. 22:00-06:00)', () => {
      expect(isTimeInRange(
        { hour: 23, minute: 0, day: 1 },
        { hour: 22, minute: 0 },
        { hour: 6, minute: 0 }
      )).toBe(true)
      expect(isTimeInRange(
        { hour: 3, minute: 0, day: 2 },
        { hour: 22, minute: 0 },
        { hour: 6, minute: 0 }
      )).toBe(true)
      expect(isTimeInRange(
        { hour: 12, minute: 0, day: 1 },
        { hour: 22, minute: 0 },
        { hour: 6, minute: 0 }
      )).toBe(false)
    })
  })

  describe('addMinutes', () => {
    it('should add minutes within same hour', () => {
      expect(addMinutes({ hour: 8, minute: 0, day: 1 }, 30)).toEqual({ hour: 8, minute: 30, day: 1 })
    })

    it('should carry over to next hour', () => {
      expect(addMinutes({ hour: 8, minute: 45, day: 1 }, 30)).toEqual({ hour: 9, minute: 15, day: 1 })
    })

    it('should carry over to next day', () => {
      expect(addMinutes({ hour: 23, minute: 30, day: 1 }, 60)).toEqual({ hour: 0, minute: 30, day: 2 })
    })

    it('should handle negative minutes (subtract)', () => {
      expect(addMinutes({ hour: 8, minute: 30, day: 1 }, -15)).toEqual({ hour: 8, minute: 15, day: 1 })
    })

    it('should handle negative minutes crossing hour boundary', () => {
      expect(addMinutes({ hour: 8, minute: 10, day: 1 }, -30)).toEqual({ hour: 7, minute: 40, day: 1 })
    })

    it('should handle negative minutes crossing day boundary', () => {
      expect(addMinutes({ hour: 0, minute: 10, day: 2 }, -30)).toEqual({ hour: 23, minute: 40, day: 1 })
    })

    it('should handle large additions', () => {
      expect(addMinutes({ hour: 0, minute: 0, day: 1 }, 1440)).toEqual({ hour: 0, minute: 0, day: 2 })
    })
  })

  describe('DEFAULT_INITIAL_TIME', () => {
    it('should be 8:00 day 1', () => {
      expect(DEFAULT_INITIAL_TIME).toEqual({ hour: 8, minute: 0, day: 1 })
    })
  })
})

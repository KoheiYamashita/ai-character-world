import { describe, it, expect } from 'vitest'
import { calculateStatChange } from './statusUtils'

describe('statusUtils', () => {
  describe('calculateStatChange', () => {
    describe('通常減少（perMinute なし）', () => {
      it('should apply normal decay when no actionPerMinute', () => {
        // energy: 50 - (0.05 × 60) = 47
        const result = calculateStatChange(50, 0.05, 60)
        expect(result).toBe(47)
      })

      it('should apply satiety decay rate', () => {
        // satiety: 80 - (0.1 × 30) = 77
        const result = calculateStatChange(80, 0.1, 30)
        expect(result).toBe(77)
      })

      it('should apply bladder decay rate', () => {
        // bladder: 100 - (0.15 × 60) = 91
        const result = calculateStatChange(100, 0.15, 60)
        expect(result).toBe(91)
      })
    })

    describe('perMinute で回復（sleep, eat など）', () => {
      it('should apply positive perMinute for sleep (energy recovery)', () => {
        // sleep: energy 50 + (0.208 × 60) = 62.48
        const result = calculateStatChange(50, 0.05, 60, 0.208)
        expect(result).toBeCloseTo(62.48, 2)
      })

      it('should apply positive perMinute for eat (satiety recovery)', () => {
        // eat: satiety 20 + (1.67 × 30) = 70.1
        const result = calculateStatChange(20, 0.1, 30, 1.67)
        expect(result).toBeCloseTo(70.1, 1)
      })

      it('should apply positive perMinute for bathe (hygiene recovery)', () => {
        // bathe: hygiene 30 + (3.33 × 30) = 129.9 → 100 (clamped)
        const result = calculateStatChange(30, 0.03, 30, 3.33)
        expect(result).toBe(100)
      })
    })

    describe('perMinute で消耗（work など）', () => {
      it('should apply negative perMinute for work (energy drain)', () => {
        // work: energy 80 + (-0.33 × 60) = 60.2
        const result = calculateStatChange(80, 0.05, 60, -0.33)
        expect(result).toBeCloseTo(60.2, 1)
      })

      it('should apply negative perMinute for work (mood drain)', () => {
        // work: mood 70 + (-0.08 × 120) = 60.4
        const result = calculateStatChange(70, 0.02, 120, -0.08)
        expect(result).toBeCloseTo(60.4, 1)
      })
    })

    describe('クランプ処理', () => {
      it('should clamp to 0 when result is negative (normal decay)', () => {
        // 10 - (0.1 × 200) = -10 → 0
        const result = calculateStatChange(10, 0.1, 200)
        expect(result).toBe(0)
      })

      it('should clamp to 0 when result is negative (perMinute)', () => {
        // 20 + (-0.33 × 100) = -13 → 0
        const result = calculateStatChange(20, 0.05, 100, -0.33)
        expect(result).toBe(0)
      })

      it('should clamp to 100 when result exceeds 100', () => {
        // 80 + (0.208 × 200) = 121.6 → 100
        const result = calculateStatChange(80, 0.05, 200, 0.208)
        expect(result).toBe(100)
      })

      it('should not clamp when value is within range', () => {
        // 50 + (0.208 × 60) = 62.48 (within 0-100)
        const result = calculateStatChange(50, 0.05, 60, 0.208)
        expect(result).toBeCloseTo(62.48, 2)
        expect(result).toBeGreaterThan(0)
        expect(result).toBeLessThan(100)
      })
    })

    describe('エッジケース', () => {
      it('should handle zero elapsed time', () => {
        const result = calculateStatChange(50, 0.05, 0)
        expect(result).toBe(50)
      })

      it('should handle zero elapsed time with perMinute', () => {
        const result = calculateStatChange(50, 0.05, 0, 0.208)
        expect(result).toBe(50)
      })

      it('should handle zero perMinute (no change)', () => {
        // perMinute = 0 means no decay and no recovery
        const result = calculateStatChange(50, 0.05, 60, 0)
        expect(result).toBe(50)
      })

      it('should handle value at boundary (0)', () => {
        const result = calculateStatChange(0, 0.05, 60)
        expect(result).toBe(0)
      })

      it('should handle value at boundary (100)', () => {
        const result = calculateStatChange(100, 0.05, 60)
        expect(result).toBe(97)
      })

      it('should handle very small elapsed time', () => {
        // 1分間の減少: 50 - (0.05 × 1) = 49.95
        const result = calculateStatChange(50, 0.05, 1)
        expect(result).toBeCloseTo(49.95, 2)
      })
    })

    describe('設計仕様の検証（docs/action-system.md）', () => {
      // world-config.json の実際の値を使用したテスト
      const decayRates = {
        satietyPerMinute: 0.1,
        energyPerMinute: 0.05,
        hygienePerMinute: 0.03,
        moodPerMinute: 0.02,
        bladderPerMinute: 0.15,
      }

      const sleepPerMinute = { energy: 0.208, mood: 0.042 }
      const workPerMinute = { energy: -0.33, mood: -0.08 }

      it('sleep 中は energy が回復し、通常減少は適用されない', () => {
        // 8時間睡眠: energy 20 + (0.208 × 480) = 119.84 → 100
        const result = calculateStatChange(20, decayRates.energyPerMinute, 480, sleepPerMinute.energy)
        expect(result).toBe(100)
      })

      it('sleep 中でも satiety は通常減少する', () => {
        // 8時間睡眠中: satiety 80 - (0.1 × 480) = 32
        const result = calculateStatChange(80, decayRates.satietyPerMinute, 480)
        expect(result).toBe(32)
      })

      it('work 中は energy が消耗する', () => {
        // 4時間仕事: energy 80 + (-0.33 × 240) = 0.8
        const result = calculateStatChange(80, decayRates.energyPerMinute, 240, workPerMinute.energy)
        expect(result).toBeCloseTo(0.8, 1)
      })

      it('work 中は mood が消耗する', () => {
        // 4時間仕事: mood 70 + (-0.08 × 240) = 50.8
        const result = calculateStatChange(70, decayRates.moodPerMinute, 240, workPerMinute.mood)
        expect(result).toBeCloseTo(50.8, 1)
      })
    })
  })
})

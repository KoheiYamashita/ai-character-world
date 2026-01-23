import { describe, it, expect } from 'vitest'
import {
  FACILITY_TAG_TO_ACTION_ID,
  ACTION_TO_FACILITY_TAGS,
  getActionsForTags,
} from './facilityMapping'

describe('facilityMapping', () => {
  describe('FACILITY_TAG_TO_ACTION_ID', () => {
    it('should map each tag to correct action ID', () => {
      expect(FACILITY_TAG_TO_ACTION_ID['kitchen']).toBe('eat')
      expect(FACILITY_TAG_TO_ACTION_ID['restaurant']).toBe('eat')
      expect(FACILITY_TAG_TO_ACTION_ID['bathroom']).toBe('bathe')
      expect(FACILITY_TAG_TO_ACTION_ID['hotspring']).toBe('bathe')
      expect(FACILITY_TAG_TO_ACTION_ID['bedroom']).toBe('sleep')
      expect(FACILITY_TAG_TO_ACTION_ID['toilet']).toBe('toilet')
      expect(FACILITY_TAG_TO_ACTION_ID['workspace']).toBe('work')
      expect(FACILITY_TAG_TO_ACTION_ID['public']).toBe('rest')
    })
  })

  describe('ACTION_TO_FACILITY_TAGS', () => {
    it('should reverse-map eat to kitchen and restaurant', () => {
      expect(ACTION_TO_FACILITY_TAGS['eat']).toContain('kitchen')
      expect(ACTION_TO_FACILITY_TAGS['eat']).toContain('restaurant')
    })

    it('should reverse-map sleep to bedroom', () => {
      expect(ACTION_TO_FACILITY_TAGS['sleep']).toContain('bedroom')
    })

    it('should have entries for all action IDs in FACILITY_TAG_TO_ACTION_ID', () => {
      const actionIds = new Set(Object.values(FACILITY_TAG_TO_ACTION_ID))
      for (const actionId of actionIds) {
        expect(ACTION_TO_FACILITY_TAGS[actionId]).toBeDefined()
        expect(ACTION_TO_FACILITY_TAGS[actionId].length).toBeGreaterThan(0)
      }
    })
  })

  describe('getActionsForTags', () => {
    it('should return actions for known tags', () => {
      expect(getActionsForTags(['bedroom'])).toEqual(['sleep'])
      expect(getActionsForTags(['kitchen'])).toEqual(['eat'])
    })

    it('should deduplicate actions from multiple tags with same action', () => {
      const result = getActionsForTags(['kitchen', 'restaurant'])
      expect(result).toEqual(['eat'])
    })

    it('should combine actions from different tags', () => {
      const result = getActionsForTags(['bedroom', 'kitchen'])
      expect(result).toEqual(['sleep', 'eat'])
    })

    it('should return empty array for empty input', () => {
      expect(getActionsForTags([])).toEqual([])
    })

    it('should ignore unknown tags', () => {
      expect(getActionsForTags(['unknown_tag'])).toEqual([])
    })

    it('should handle mix of known and unknown tags', () => {
      const result = getActionsForTags(['unknown', 'bedroom', 'invalid'])
      expect(result).toEqual(['sleep'])
    })
  })
})

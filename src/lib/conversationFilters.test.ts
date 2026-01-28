import { describe, it, expect } from 'vitest'
import { filterForBehaviorDecision, filterForConversation, filterNPCsByCooldown, addCooldownInfoToNPCs, CONVERSATION_COOLDOWN_MINUTES } from './conversationFilters'
import type { RecentConversation } from '@/types/behavior'
import type { SimNPC } from '@/server/simulation/types'

describe('conversationFilters', () => {
  // テスト用のサンプルデータ
  const createConversation = (npcId: string, npcName: string, timestamp: number): RecentConversation => ({
    npcId,
    npcName,
    summary: `Conversation with ${npcName}`,
    timestamp,
  })

  describe('filterForBehaviorDecision', () => {
    it('undefined の場合は空配列を返す', () => {
      expect(filterForBehaviorDecision(undefined)).toEqual([])
    })

    it('空配列の場合は空配列を返す', () => {
      expect(filterForBehaviorDecision([])).toEqual([])
    })

    it('3件以下の場合はそのまま返す（timestamp順）', () => {
      const conversations = [
        createConversation('npc1', 'Alice', 100),
        createConversation('npc2', 'Bob', 200),
      ]
      const result = filterForBehaviorDecision(conversations)
      expect(result).toHaveLength(2)
      expect(result[0].npcId).toBe('npc2') // 新しい順
      expect(result[1].npcId).toBe('npc1')
    })

    it('4件以上の場合は直近3件のみ返す', () => {
      const conversations = [
        createConversation('npc1', 'Alice', 100),
        createConversation('npc2', 'Bob', 200),
        createConversation('npc3', 'Carol', 300),
        createConversation('npc4', 'Dave', 400),
        createConversation('npc5', 'Eve', 500),
      ]
      const result = filterForBehaviorDecision(conversations)
      expect(result).toHaveLength(3)
      expect(result[0].npcId).toBe('npc5') // timestamp 500
      expect(result[1].npcId).toBe('npc4') // timestamp 400
      expect(result[2].npcId).toBe('npc3') // timestamp 300
    })

    it('元の配列を変更しない', () => {
      const conversations = [
        createConversation('npc1', 'Alice', 100),
        createConversation('npc2', 'Bob', 200),
      ]
      const original = [...conversations]
      filterForBehaviorDecision(conversations)
      expect(conversations).toEqual(original)
    })
  })

  describe('filterForConversation', () => {
    it('undefined の場合は空配列を返す', () => {
      expect(filterForConversation(undefined, 'npc1')).toEqual([])
    })

    it('空配列の場合は空配列を返す', () => {
      expect(filterForConversation([], 'npc1')).toEqual([])
    })

    it('対象NPCの会話は全件返す', () => {
      const conversations = [
        createConversation('npc1', 'Alice', 100),
        createConversation('npc1', 'Alice', 200),
        createConversation('npc1', 'Alice', 300),
        createConversation('npc1', 'Alice', 400),
      ]
      const result = filterForConversation(conversations, 'npc1')
      expect(result).toHaveLength(4)
    })

    it('他NPCは各NPC最新1件のみ返す', () => {
      const conversations = [
        createConversation('npc2', 'Bob', 100),
        createConversation('npc2', 'Bob', 200),  // npc2 の最新
        createConversation('npc3', 'Carol', 150),
        createConversation('npc3', 'Carol', 250), // npc3 の最新
      ]
      const result = filterForConversation(conversations, 'npc1')
      expect(result).toHaveLength(2)
      expect(result.find(c => c.npcId === 'npc2')?.timestamp).toBe(200)
      expect(result.find(c => c.npcId === 'npc3')?.timestamp).toBe(250)
    })

    it('対象NPC全件 + 他NPC各1件を結合して新しい順で返す', () => {
      const conversations = [
        createConversation('npc1', 'Alice', 100), // 対象
        createConversation('npc2', 'Bob', 150),
        createConversation('npc1', 'Alice', 200), // 対象
        createConversation('npc2', 'Bob', 250),   // npc2 の最新
        createConversation('npc1', 'Alice', 300), // 対象
        createConversation('npc3', 'Carol', 350), // npc3 の最新
      ]
      const result = filterForConversation(conversations, 'npc1')
      // 対象NPC 3件 + 他NPC 2件（npc2, npc3）= 5件
      expect(result).toHaveLength(5)
      // timestamp降順でソート
      expect(result[0].timestamp).toBe(350) // npc3
      expect(result[1].timestamp).toBe(300) // npc1
      expect(result[2].timestamp).toBe(250) // npc2
      expect(result[3].timestamp).toBe(200) // npc1
      expect(result[4].timestamp).toBe(100) // npc1
    })

    it('対象NPCのみ存在する場合', () => {
      const conversations = [
        createConversation('npc1', 'Alice', 100),
        createConversation('npc1', 'Alice', 200),
      ]
      const result = filterForConversation(conversations, 'npc1')
      expect(result).toHaveLength(2)
    })

    it('対象NPCが存在しない場合（他NPCのみ）', () => {
      const conversations = [
        createConversation('npc2', 'Bob', 100),
        createConversation('npc2', 'Bob', 200),
        createConversation('npc3', 'Carol', 150),
      ]
      const result = filterForConversation(conversations, 'npc1')
      // 他NPC各1件のみ
      expect(result).toHaveLength(2)
      expect(result.find(c => c.npcId === 'npc2')?.timestamp).toBe(200)
      expect(result.find(c => c.npcId === 'npc3')?.timestamp).toBe(150)
    })

    it('元の配列を変更しない', () => {
      const conversations = [
        createConversation('npc1', 'Alice', 100),
        createConversation('npc2', 'Bob', 200),
      ]
      const original = [...conversations]
      filterForConversation(conversations, 'npc1')
      expect(conversations).toEqual(original)
    })
  })

  describe('filterNPCsByCooldown', () => {
    // テスト用のSimNPC作成ヘルパー
    const createNPC = (id: string, name: string): SimNPC => ({
      id,
      name,
      mapId: 'test-map',
      currentNodeId: 'node-1',
      position: { x: 100, y: 100 },
      direction: 'down',
      isInConversation: false,
    })

    it('recentConversations が undefined の場合は全NPCを返す', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const result = filterNPCsByCooldown(npcs, undefined, 1000)
      expect(result).toHaveLength(2)
    })

    it('recentConversations が空の場合は全NPCを返す', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const result = filterNPCsByCooldown(npcs, [], 1000)
      expect(result).toHaveLength(2)
    })

    it('会話履歴がないNPCは含まれる', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const conversations = [createConversation('npc1', 'Alice', 900)]
      // npc2は会話履歴なし → 含まれる
      const result = filterNPCsByCooldown(npcs, conversations, 1000)
      expect(result.some(n => n.id === 'npc2')).toBe(true)
    })

    it('クールダウン期間内のNPCは除外される', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      // 現在時刻1000、npc1と950に会話 → 経過50分 < 60分 → 除外
      const conversations = [createConversation('npc1', 'Alice', 950)]
      const result = filterNPCsByCooldown(npcs, conversations, 1000)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('npc2')
    })

    it('クールダウン期間外のNPCは含まれる', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      // 現在時刻1000、npc1と930に会話 → 経過70分 >= 60分 → 含まれる
      const conversations = [createConversation('npc1', 'Alice', 930)]
      const result = filterNPCsByCooldown(npcs, conversations, 1000)
      expect(result).toHaveLength(2)
    })

    it('クールダウンちょうど60分経過は含まれる', () => {
      const npcs = [createNPC('npc1', 'Alice')]
      // 現在時刻1000、npc1と940に会話 → 経過60分 == 60分 → 含まれる
      const conversations = [createConversation('npc1', 'Alice', 940)]
      const result = filterNPCsByCooldown(npcs, conversations, 1000)
      expect(result).toHaveLength(1)
    })

    it('同じNPCとの複数会話は最新のものでクールダウン判定', () => {
      const npcs = [createNPC('npc1', 'Alice')]
      // npc1と800と950に会話 → 最新950、経過50分 < 60分 → 除外
      const conversations = [
        createConversation('npc1', 'Alice', 800),
        createConversation('npc1', 'Alice', 950),
      ]
      const result = filterNPCsByCooldown(npcs, conversations, 1000)
      expect(result).toHaveLength(0)
    })

    it('複数NPCの混在ケース', () => {
      const npcs = [
        createNPC('npc1', 'Alice'),
        createNPC('npc2', 'Bob'),
        createNPC('npc3', 'Carol'),
      ]
      const conversations = [
        createConversation('npc1', 'Alice', 950),  // 経過50分 → 除外
        createConversation('npc2', 'Bob', 900),    // 経過100分 → 含まれる
        // npc3は会話履歴なし → 含まれる
      ]
      const result = filterNPCsByCooldown(npcs, conversations, 1000)
      expect(result).toHaveLength(2)
      expect(result.map(n => n.id).sort()).toEqual(['npc2', 'npc3'])
    })

    it('CONVERSATION_COOLDOWN_MINUTES が60であることを確認', () => {
      expect(CONVERSATION_COOLDOWN_MINUTES).toBe(60)
    })

    it('元の配列を変更しない', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const conversations = [createConversation('npc1', 'Alice', 950)]
      const originalNpcs = [...npcs]
      const originalConversations = [...conversations]
      filterNPCsByCooldown(npcs, conversations, 1000)
      expect(npcs).toEqual(originalNpcs)
      expect(conversations).toEqual(originalConversations)
    })
  })

  describe('addCooldownInfoToNPCs', () => {
    // テスト用のSimNPC作成ヘルパー
    const createNPC = (id: string, name: string): SimNPC => ({
      id,
      name,
      mapId: 'test-map',
      currentNodeId: 'node-1',
      position: { x: 100, y: 100 },
      direction: 'down',
      isInConversation: false,
    })

    it('空のNPC配列の場合は空配列を返す', () => {
      const result = addCooldownInfoToNPCs([], undefined, 1000)
      expect(result).toEqual([])
    })

    it('recentConversations が undefined の場合は全NPCに nextAvailableTime なしで返す', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const result = addCooldownInfoToNPCs(npcs, undefined, 1000)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ id: 'npc1', name: 'Alice' })
      expect(result[1]).toEqual({ id: 'npc2', name: 'Bob' })
      expect(result[0].nextAvailableTime).toBeUndefined()
      expect(result[1].nextAvailableTime).toBeUndefined()
    })

    it('recentConversations が空の場合は全NPCに nextAvailableTime なしで返す', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const result = addCooldownInfoToNPCs(npcs, [], 1000)
      expect(result).toHaveLength(2)
      expect(result[0].nextAvailableTime).toBeUndefined()
      expect(result[1].nextAvailableTime).toBeUndefined()
    })

    it('会話履歴がないNPCは nextAvailableTime なし', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const conversations = [createConversation('npc1', 'Alice', 900)]
      const result = addCooldownInfoToNPCs(npcs, conversations, 1000)
      // npc2は会話履歴なし
      const npc2 = result.find(n => n.id === 'npc2')
      expect(npc2?.nextAvailableTime).toBeUndefined()
    })

    it('クールダウン期間内のNPCは nextAvailableTime が設定される', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      // 現在時刻: day1 16:40 (1*24*60 + 16*60 + 40 = 2440)
      // npc1と16:00 (1*24*60 + 16*60 = 2400)に会話 → 経過40分 < 60分 → クールダウン中
      // 次回会話可能: 16:00 + 60分 = 17:00
      const conversations = [createConversation('npc1', 'Alice', 2400)]
      const result = addCooldownInfoToNPCs(npcs, conversations, 2440)
      const npc1 = result.find(n => n.id === 'npc1')
      expect(npc1?.nextAvailableTime).toBe('17:00')
    })

    it('クールダウン期間外のNPCは nextAvailableTime なし', () => {
      const npcs = [createNPC('npc1', 'Alice')]
      // 現在時刻: 1000、npc1と930に会話 → 経過70分 >= 60分 → クールダウン終了
      const conversations = [createConversation('npc1', 'Alice', 930)]
      const result = addCooldownInfoToNPCs(npcs, conversations, 1000)
      expect(result[0].nextAvailableTime).toBeUndefined()
    })

    it('クールダウンちょうど60分経過は nextAvailableTime なし', () => {
      const npcs = [createNPC('npc1', 'Alice')]
      // 現在時刻: 1000、npc1と940に会話 → 経過60分 == 60分 → クールダウン終了
      const conversations = [createConversation('npc1', 'Alice', 940)]
      const result = addCooldownInfoToNPCs(npcs, conversations, 1000)
      expect(result[0].nextAvailableTime).toBeUndefined()
    })

    it('同じNPCとの複数会話は最新のものでクールダウン判定', () => {
      const npcs = [createNPC('npc1', 'Alice')]
      // npc1と800と950に会話 → 最新950、現在1000、経過50分 < 60分 → クールダウン中
      // 次回会話可能: 950 + 60 = 1010 → 16:50
      const conversations = [
        createConversation('npc1', 'Alice', 800),
        createConversation('npc1', 'Alice', 950),
      ]
      const result = addCooldownInfoToNPCs(npcs, conversations, 1000)
      expect(result[0].nextAvailableTime).toBe('16:50')
    })

    it('複数NPCの混在ケース（クールダウン中と会話可能が混在）', () => {
      const npcs = [
        createNPC('npc1', 'Alice'),
        createNPC('npc2', 'Bob'),
        createNPC('npc3', 'Carol'),
      ]
      // 現在時刻: 1000 (16:40)
      const conversations = [
        createConversation('npc1', 'Alice', 950),  // 経過50分 → クールダウン中、次回16:50
        createConversation('npc2', 'Bob', 900),    // 経過100分 → 会話可能
        // npc3は会話履歴なし → 会話可能
      ]
      const result = addCooldownInfoToNPCs(npcs, conversations, 1000)
      expect(result).toHaveLength(3)

      const npc1 = result.find(n => n.id === 'npc1')
      const npc2 = result.find(n => n.id === 'npc2')
      const npc3 = result.find(n => n.id === 'npc3')

      expect(npc1?.nextAvailableTime).toBe('16:50') // クールダウン中
      expect(npc2?.nextAvailableTime).toBeUndefined() // 会話可能
      expect(npc3?.nextAvailableTime).toBeUndefined() // 会話可能
    })

    it('日跨ぎの時刻計算（nextAvailableTime が翌日になるケース）', () => {
      const npcs = [createNPC('npc1', 'Alice')]
      // 現在時刻: day2 23:30 (2*24*60 + 23*60 + 30 = 4290)
      // npc1と23:10 (2*24*60 + 23*60 + 10 = 4270)に会話 → 経過20分 < 60分
      // 次回会話可能: 4270 + 60 = 4330 → 翌日 00:10
      const conversations = [createConversation('npc1', 'Alice', 4270)]
      const result = addCooldownInfoToNPCs(npcs, conversations, 4290)
      expect(result[0].nextAvailableTime).toBe('00:10') // 翌日の時刻
    })

    it('元の配列を変更しない', () => {
      const npcs = [createNPC('npc1', 'Alice'), createNPC('npc2', 'Bob')]
      const conversations = [createConversation('npc1', 'Alice', 950)]
      const originalNpcs = [...npcs]
      const originalConversations = [...conversations]
      addCooldownInfoToNPCs(npcs, conversations, 1000)
      expect(npcs).toEqual(originalNpcs)
      expect(conversations).toEqual(originalConversations)
    })
  })
})

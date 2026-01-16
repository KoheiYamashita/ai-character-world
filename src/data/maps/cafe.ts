import type { GameMap } from '@/types'
import { generateGridNodes } from './grid'

const nodes = generateGridNodes(
  { prefix: 'cafe' },
  [
    { nodeId: 'cafe-4-2', label: 'Lobby', type: 'spawn' },
    { nodeId: 'cafe-4-6', label: 'Counter' },
    { nodeId: 'cafe-1-9', label: 'Table 1' },
    { nodeId: 'cafe-4-9', label: 'Table 2' },
    { nodeId: 'cafe-7-9', label: 'Table 3' },
  ],
  [
    {
      id: 'cafe-door',
      x: 30,
      y: 300,
      connectedNodeIds: ['cafe-4-0', 'cafe-5-0'],
      leadsTo: { mapId: 'town', nodeId: 'cafe-entrance' },
      label: 'Exit',
    },
  ]
)

export const cafeMap: GameMap = {
  id: 'cafe',
  name: 'Cafe',
  width: 800,
  height: 600,
  backgroundColor: 0xd4956a,
  spawnNodeId: 'cafe-door',
  nodes,
}

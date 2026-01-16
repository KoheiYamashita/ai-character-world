import type { GameMap } from '@/types'
import { generateGridNodes } from './grid'

const nodes = generateGridNodes(
  { prefix: 'home' },
  [
    { nodeId: 'home-4-5', label: 'Living Room', type: 'spawn' },
    { nodeId: 'home-1-2', label: 'Bedroom' },
    { nodeId: 'home-1-9', label: 'Kitchen' },
    { nodeId: 'home-1-5', label: 'Bathroom' },
  ],
  [
    {
      id: 'home-door',
      x: 400,
      y: 570,
      connectedNodeIds: ['home-8-5', 'home-8-6'],
      leadsTo: { mapId: 'town', nodeId: 'home-entrance' },
      label: 'Exit',
    },
  ]
)

export const homeMap: GameMap = {
  id: 'home',
  name: 'Home',
  width: 800,
  height: 600,
  backgroundColor: 0x8b7355,
  spawnNodeId: 'home-door',
  nodes,
}

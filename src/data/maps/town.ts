import type { GameMap } from '@/types'
import { generateGridNodes } from './grid'

const nodes = generateGridNodes(
  { prefix: 'town' },
  [{ nodeId: 'town-4-5', label: 'Town Center', type: 'spawn' }],
  [
    {
      id: 'home-entrance',
      x: 400,
      y: 30,
      connectedNodeIds: ['town-0-5', 'town-0-6'],
      leadsTo: { mapId: 'home', nodeId: 'home-door' },
      label: 'Home',
    },
    {
      id: 'cafe-entrance',
      x: 770,
      y: 300,
      connectedNodeIds: ['town-4-11', 'town-5-11'],
      leadsTo: { mapId: 'cafe', nodeId: 'cafe-door' },
      label: 'Cafe',
    },
  ]
)

export const townMap: GameMap = {
  id: 'town',
  name: 'Town Square',
  width: 800,
  height: 600,
  backgroundColor: 0x4a7c59,
  spawnNodeId: 'town-4-5',
  nodes,
}

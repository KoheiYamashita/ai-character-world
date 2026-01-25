import { WorldCanvas } from '@/components/world/WorldCanvas'
import { TopBar } from '@/components/panels/TopBar'
import { CharacterPanel } from '@/components/panels/CharacterPanel'
import { ActivityLogPanel } from '@/components/panels/ActivityLogPanel'

export default function Home() {
  return (
    <main className="h-screen bg-slate-900 flex flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <WorldCanvas />
        <div className="flex-1 h-full flex flex-col">
          <CharacterPanel />
          <ActivityLogPanel />
        </div>
      </div>
    </main>
  )
}

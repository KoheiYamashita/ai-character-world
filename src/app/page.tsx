import { GameCanvas } from '@/components/game/GameCanvas'
import { StatusPanel } from '@/components/panels/StatusPanel'

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6">AI Agent World</h1>
        <div className="flex gap-6">
          <GameCanvas />
          <StatusPanel />
        </div>
      </div>
    </main>
  )
}

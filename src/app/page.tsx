import { WorldCanvas } from '@/components/world/WorldCanvas'
import { StatusPanel } from '@/components/panels/StatusPanel'
import { ActivityLogPanel } from '@/components/panels/ActivityLogPanel'

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6">AI Character World</h1>
        <div className="flex gap-6">
          <div className="flex flex-col gap-4">
            <WorldCanvas />
            <ActivityLogPanel />
          </div>
          <StatusPanel />
        </div>
      </div>
    </main>
  )
}

'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'

const MapPreview = dynamic(() => import('@/components/world/MapPreview'), {
  ssr: false,
})

function PreviewContent() {
  const searchParams = useSearchParams()
  const mapId = searchParams.get('map') || 'town'
  return <MapPreview mapId={mapId} />
}

export default function PreviewPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <PreviewContent />
    </Suspense>
  )
}

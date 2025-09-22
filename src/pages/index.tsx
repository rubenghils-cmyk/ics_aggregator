import { useEffect, useMemo, useState } from 'react'

type Ev = {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  source: string
  description?: string
}

type ApiResp = { range: { timeMin: string; timeMax: string }; count: number; events: Ev[] }

export default function Home() {
  const [data, setData] = useState<ApiResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    fetch(`/api/aggregate?${params.toString()}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => {
    if (!data) return {}
    return data.events.reduce((acc: Record<string, Ev[]>, ev) => {
      const d = new Date(ev.start).toLocaleDateString()
      acc[d] = acc[d] || []
      acc[d].push(ev)
      return acc
    }, {} as Record<string, Ev[]>)
  }, [data])

  if (loading) return <main className="p-6">Lade…</main>
  if (error) return <main className="p-6 text-red-600">Fehler: {error}</main>
  if (!data) return <main className="p-6">Keine Daten</main>

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Aggregierte Termine</h1>
      <p className="text-sm text-gray-600 mb-6">
        Zeitraum: {new Date(data.range.timeMin).toLocaleString()} – {new Date(data.range.timeMax).toLocaleString()} · {data.count} Events
      </p>
      <div className="space-y-6">
        {Object.entries(grouped).map(([date, events]) => (
          <section key={date}>
            <h2 className="font-semibold mb-2">{date}</h2>
            <ul className="divide-y border rounded-md">
              {events.map(ev => (
                <li key={ev.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{ev.title}</div>
                      <div className="text-sm text-gray-600">
                        {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' — '}
                        {new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </div>
                      <div className="text-xs text-gray-500">{ev.source}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}

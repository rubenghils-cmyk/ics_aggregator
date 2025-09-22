import type { NextApiRequest, NextApiResponse } from 'next'
import { expandAndNormalize } from '@/lib/ics'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const now = new Date()
    const lookaheadDays = Number(process.env.DEFAULT_LOOKAHEAD_DAYS ?? 30)
    const lookbackDays = Number(process.env.DEFAULT_LOOKBACK_DAYS ?? 7)

    const timeMin = req.query.timeMin ? new Date(String(req.query.timeMin)) : new Date(now.getTime() - lookbackDays*86400_000)
    const timeMax = req.query.timeMax ? new Date(String(req.query.timeMax)) : new Date(now.getTime() + lookaheadDays*86400_000)

    const sourcesEnv = process.env.ICS_SOURCES
    if (!sourcesEnv) throw new Error('ICS_SOURCES fehlt (.env.local)')
    const sources: { url: string, label: string }[] = JSON.parse(sourcesEnv)

    const events = await expandAndNormalize(sources, { timeMin, timeMax })

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    res.status(200).json({
      range: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() },
      count: events.length,
      events,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

import ical from 'ical'
import { RRuleSet, rrulestr } from 'rrule'
import { DateTime } from 'luxon'

export type Source = { url: string; label: string }
export type NormalizedEvent = {
  id: string
  title: string
  start: string // ISO UTC
  end: string   // ISO UTC
  allDay: boolean
  location?: string
  source: string
  description?: string
}

// mini-cache (in-memory) um ICS nicht bei jeder Anfrage erneut zu laden
const cache = new Map<string, { ts: number; text: string }>()
const TTL_MS = 5 * 60_000

async function fetchICS(url: string): Promise<string> {
  const hit = cache.get(url)
  const now = Date.now()
  if (hit && now - hit.ts < TTL_MS) return hit.text
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch ICS failed ${res.status} for ${url}`)
  const text = await res.text()
  cache.set(url, { ts: now, text })
  return text
}

function toUTCISO(date: Date | string | number): string {
  const dt = typeof date === 'number' ? DateTime.fromMillis(date) : DateTime.fromJSDate(new Date(date))
  return dt.toUTC().toISO({ suppressMilliseconds: true }) as string
}

function normalizeSingle(e: any, label: string): Omit<NormalizedEvent, 'id'> & { uid: string } | null {
  if (!e || e.type !== 'VEVENT') return null

  // ICS Felder
  const uid = e.uid || `${e.summary}|${e.start?.toISOString?.() ?? ''}|${e.location ?? ''}`
  const title = e.summary || '(ohne Titel)'
  const location = e.location
  const description = typeof e.description === 'string' ? e.description : undefined

  // Ganztägig: wenn DTSTART als date (ohne Zeit) kommt
  const allDay = !!(e.datetype === 'date' || e.start?.isDate)

  if (!e.start || !e.end) return null

  return {
    uid,
    title,
    location,
    description,
    allDay,
    start: toUTCISO(e.start),
    end: toUTCISO(e.end),
    source: `ics:${label}`,
  }
}

// Serien-Expansion (rudimentär): RRULE/EXDATE/RECURRENCE-ID
function expandRecurrence(master: any, windowMin: Date, windowMax: Date): Date[] {
  const rule: string | undefined = master.rrule?.toString?.()
  const set = new RRuleSet()
  if (rule) set.rrule(rrulestr(rule))
  // EXDATE
  if (master.exdate) {
    Object.values(master.exdate).forEach((d: any) => set.exdate(new Date(d)))
  }
  // DTSTART als Start
  const dtstart = master.start instanceof Date ? master.start : new Date(master.start)
  if (!rule) return [dtstart] // kein RRULE => Einzeltermin

  const dates = set.between(windowMin, windowMax, true)
  return dates.length ? dates : []
}

export async function expandAndNormalize(sources: Source[], opts: { timeMin: Date; timeMax: Date }): Promise<NormalizedEvent[]> {
  const all: NormalizedEvent[] = []

  for (const s of sources) {
    const text = await fetchICS(s.url)
    const data = ical.parseICS(text)

    for (const k of Object.keys(data)) {
      const item = data[k]
      if (!item || item.type !== 'VEVENT') continue

      // Expand series → instances in Fenster
      const instances = expandRecurrence(item, opts.timeMin, opts.timeMax)
      if (instances.length === 0) {
        // Einzeltermin oder außerhalb des Fensters
        const norm = normalizeSingle(item, s.label)
        if (!norm) continue
        const start = new Date(norm.start)
        const end = new Date(norm.end)
        if (end < opts.timeMin || start > opts.timeMax) continue
        all.push({ id: `${norm.uid}|${norm.start}`, ...norm })
      } else {
        // Für jede Instanz Start/Ende ableiten (Dauer vom Master)
        const masterNorm = normalizeSingle(item, s.label)
        if (!masterNorm) continue
        const dur = new Date(masterNorm.end).getTime() - new Date(masterNorm.start).getTime()
        for (const inst of instances) {
          const startISO = toUTCISO(inst)
          const endISO = toUTCISO(new Date(new Date(inst).getTime() + dur))
          const id = `${masterNorm.uid}|${startISO}`
          all.push({
            id,
            title: masterNorm.title,
            start: startISO,
            end: endISO,
            allDay: masterNorm.allDay,
            location: masterNorm.location,
            description: masterNorm.description,
            source: masterNorm.source,
          })
        }
      }
    }
  }

  // Dedupe: id ist uid+start → Map last wins
  const map = new Map<string, NormalizedEvent>()
  all.forEach(ev => map.set(ev.id, ev))
  const merged = Array.from(map.values())
  merged.sort((a, b) => a.start.localeCompare(b.start))
  return merged
}

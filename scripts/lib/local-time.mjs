// The owner's clock, for the two things a run cannot get right in UTC.
//
// 1. The date in a file name. A run at 21:13 in La Paz is 01:13 the next day in UTC, so its
//    report was filed under tomorrow. The next morning's scheduled run then found "today's"
//    report already written, stopped, and left no trace (TESTING.md S3-14, S3-26).
// 2. Whether the clock fired this run. A routine's scheduled fire and a Run now press arrive in
//    the same environment with the same prompt, so the environment cannot tell them apart. The
//    workflow's own schedule can: it is written in the owner's local time.
//
// The time zone comes from the "Time zone and working hours" section of shared/about-me.md,
// which onboarding fills in the owner's own words. An IANA name there (America/La_Paz) is used
// as is, daylight saving included. Failing that, a written offset (UTC-4, GMT+05:30) is used as a
// fixed offset. Failing both, the answer is null and callers fall back to UTC and say so.

const SECTION = /^##\s+Time zone[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im
const IANA = /\b([A-Z][A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/g
const OFFSET = /\b(?:UTC|GMT)\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?\b/i

function isZone(name) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

export function timeZoneFrom(aboutMe) {
  const section = SECTION.exec(String(aboutMe ?? ''))
  if (!section) return null
  const text = section[1].replace(/<!--[\s\S]*?-->/g, '')
  for (const [, name] of text.matchAll(IANA)) {
    if (isZone(name)) return { zone: name, label: name }
  }
  const offset = OFFSET.exec(text)
  if (offset) {
    const sign = offset[1] === '+' ? 1 : -1
    const minutes = sign * (Number(offset[2]) * 60 + Number(offset[3] ?? 0))
    const hh = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')
    const mm = String(Math.abs(minutes) % 60).padStart(2, '0')
    return { offsetMinutes: minutes, label: `UTC${sign > 0 ? '+' : '-'}${hh}:${mm}` }
  }
  return null
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const pad = (n) => String(n).padStart(2, '0')

// The owner's calendar date, weekday and minute of the day at `date`. UTC when `tz` is null.
export function localParts(date, tz) {
  if (tz?.zone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz.zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
      }).formatToParts(date).map((part) => [part.type, part.value])
    )
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      weekday: parts.weekday.toLowerCase().slice(0, 3),
      minutes: Number(parts.hour) * 60 + Number(parts.minute)
    }
  }
  const shifted = new Date(date.getTime() + (tz?.offsetMinutes ?? 0) * 60_000)
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    weekday: WEEKDAYS[shifted.getUTCDay()],
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  }
}

// A routine fires a few minutes after its slot, not on it: 12:05 and 12:07 for a 12:00 slot, and
// 21:02 for 21:00, on the runs observed. Twenty minutes covers that with room. A Run now pressed
// inside that window reads as scheduled, which is the error worth having: the other way round, a
// real scheduled run read as manual, would hide the clock's work from the board.
export const FIRE_WINDOW_MINUTES = 20

// true: the clock fired this. false: nothing was due, so a person did. null: cannot tell, because
// the schedule is an interval ("every 2 hours") or not one of the forms this repo writes.
export function firedBySchedule(schedule, parts, windowMinutes = FIRE_WINDOW_MINUTES) {
  const form = /^(daily|weekdays|weekly (sun|mon|tue|wed|thu|fri|sat)) (\d{1,2}):(\d{2})$/.exec(
    String(schedule ?? '').trim().toLowerCase()
  )
  if (!form) return null
  const slot = Number(form[3]) * 60 + Number(form[4])
  // Late enough to cross midnight: the slot was yesterday, on yesterday's weekday.
  const late = (parts.minutes - slot + 1440) % 1440
  if (late > windowMinutes) return false
  const day = parts.minutes >= slot ? parts.weekday : WEEKDAYS[(WEEKDAYS.indexOf(parts.weekday) + 6) % 7]
  if (form[1] === 'daily') return true
  if (form[1] === 'weekdays') return !['sat', 'sun'].includes(day)
  return day === form[2]
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { timeZoneFrom, localParts, firedBySchedule } from '../scripts/lib/local-time.mjs'

const aboutMe = (line) => `# About me\n\n## Time zone and working hours\n${line}\n\n## Things that are always off-limits\nNone.\n`

// --- where the owner's clock comes from ---------------------------------------------------

test('an IANA name in about-me is used as is', () => {
  assert.equal(timeZoneFrom(aboutMe('La Paz, America/La_Paz. I start at 8.'))?.zone, 'America/La_Paz')
})

// Verbatim from a live student install, 2026-09-23. No IANA name, so the offset is what there is.
test('a written offset is read when there is no IANA name', () => {
  const tz = timeZoneFrom(aboutMe('Cochabamba (Bolivia time, UTC-4). I start at 8 and stop at 6.'))
  assert.deepEqual(tz, { offsetMinutes: -240, label: 'UTC-04:00' })
  assert.equal(timeZoneFrom(aboutMe('India, GMT+05:30'))?.offsetMinutes, 330)
})

test('an unfilled template, or no section, gives no time zone rather than a guess', () => {
  assert.equal(timeZoneFrom(aboutMe('<!-- fill: timezone -->')), null)
  assert.equal(timeZoneFrom('# About me\n\n## Name and role\nMaria\n'), null)
  assert.equal(timeZoneFrom(null), null)
})

test('a slash that is not a zone is not taken for one', () => {
  assert.equal(timeZoneFrom(aboutMe('Mornings/Afternoons, flexible')), null)
})

// --- the date in a file name --------------------------------------------------------------

// The S3-14 case: 21:13 in La Paz on the 24th is 01:13 UTC on the 25th. Filed under the 25th,
// it made the next morning's scheduled run find "today" already done and stop.
test('an evening run is dated on the owner\'s day, not UTC\'s', () => {
  const evening = new Date('2026-09-25T01:13:00Z')
  assert.equal(localParts(evening, { zone: 'America/La_Paz' }).date, '2026-09-24')
  assert.equal(localParts(evening, { offsetMinutes: -240 }).date, '2026-09-24')
  assert.equal(localParts(evening, null).date, '2026-09-25')
})

test('daylight saving comes from the IANA name', () => {
  // New York is UTC-4 in September and UTC-5 in December.
  assert.equal(localParts(new Date('2026-09-15T12:00:00Z'), { zone: 'America/New_York' }).minutes, 8 * 60)
  assert.equal(localParts(new Date('2026-12-15T12:00:00Z'), { zone: 'America/New_York' }).minutes, 7 * 60)
})

// --- did the clock fire this run ----------------------------------------------------------

const at = (weekday, hh, mm) => ({ weekday, minutes: hh * 60 + mm })

test('a run a few minutes after its slot was the clock', () => {
  assert.equal(firedBySchedule('weekdays 08:00', at('mon', 8, 5)), true)
  assert.equal(firedBySchedule('weekly fri 17:00', at('fri', 17, 2)), true)
  assert.equal(firedBySchedule('daily 06:30', at('sun', 6, 30)), true)
})

// The S3-38 case: Receipt Chase is due on the 2nd at 08:00, and a Run now at 14:41 was logged
// as scheduled.
test('a run when nothing was due was a person', () => {
  assert.equal(firedBySchedule('weekdays 08:00', at('wed', 14, 41)), false)
  assert.equal(firedBySchedule('weekly fri 17:00', at('thu', 17, 2)), false)
  assert.equal(firedBySchedule('weekdays 08:00', at('sat', 8, 3)), false)
  assert.equal(firedBySchedule('daily 06:30', at('mon', 6, 29)), false)
})

test('a slot just before midnight still counts on the next day', () => {
  assert.equal(firedBySchedule('weekly sun 23:55', at('mon', 0, 5)), true)
  assert.equal(firedBySchedule('weekly mon 23:55', at('mon', 0, 5)), false)
})

test('an interval or an unknown form cannot be judged, so it says so', () => {
  assert.equal(firedBySchedule('every 2 hours', at('mon', 8, 0)), null)
  assert.equal(firedBySchedule(undefined, at('mon', 8, 0)), null)
})

// --- end to end, through the command the run-log skill tells every agent to run -----------

const root = fileURLToPath(new URL('..', import.meta.url))

async function factsFor({ schedule, remote }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'run-facts-'))
  try {
    await cp(path.join(root, 'scripts'), path.join(dir, 'scripts'), { recursive: true })
    await mkdir(path.join(dir, 'shared'))
    await mkdir(path.join(dir, 'workflows'))
    await writeFile(path.join(dir, 'shared/about-me.md'), aboutMe('La Paz, America/La_Paz'))
    await writeFile(
      path.join(dir, 'workflows/receipt-chase.yml'),
      `name: Receipt Chase\nowner: email\nsteps: [check-client-documents]\ntrigger:\n  armed: true\n  schedule: "${schedule}"\n`
    )
    const run = spawnSync(process.execPath, ['scripts/run-facts.mjs', 'email', 'receipt-chase'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_REMOTE: remote ? 'true' : '', CLAUDE_CODE_REMOTE_SESSION_ID: 'abc' }
    })
    assert.equal(run.status, 0, run.stderr)
    return Object.fromEntries(run.stdout.trim().split('\n').map((line) => {
      const [field, ...rest] = line.trim().split(/\s+/)
      return [field, rest.join(' ')]
    }))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// The schedules are built from the current La Paz time, so this holds whenever the suite runs.
const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

test('run-facts calls a remote run on its slot `schedule`, and one off it `manual`', async () => {
  const now = localParts(new Date(), { zone: 'America/La_Paz' }).minutes
  const onSlot = await factsFor({ schedule: `daily ${hhmm(now)}`, remote: true })
  assert.equal(onSlot.trigger, 'schedule')
  const offSlot = await factsFor({ schedule: `daily ${hhmm((now + 180) % 1440)}`, remote: true })
  assert.equal(offSlot.trigger, 'manual')
})

test('run-facts prints the owner\'s date and the zone it used', async () => {
  const facts = await factsFor({ schedule: 'daily 08:00', remote: false })
  assert.equal(facts.date, localParts(new Date(), { zone: 'America/La_Paz' }).date)
  assert.equal(facts.timezone, 'America/La_Paz')
  assert.equal(facts.trigger, 'manual')
})

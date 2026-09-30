import { readFile } from 'node:fs/promises'
import { AGENT_SLUGS, runIdFor, monthFolderFor } from './lib/run-log.mjs'
import { parseWorkflow } from './lib/workflows.mjs'
import { timeZoneFrom, localParts, firedBySchedule } from './lib/local-time.mjs'

// Every fact a run log needs, printed the same way in every shell. The bash-only
// version of this (date -u, echo "$VAR") failed on Windows, which is where most
// students are.

const [agent, workflow] = process.argv.slice(2)

if (!agent) {
  console.error('Usage: node scripts/run-facts.mjs <agent> [workflow]')
  console.error(`Agents: ${AGENT_SLUGS.join(', ')}`)
  process.exit(1)
}

if (!AGENT_SLUGS.includes(agent)) {
  console.error(`"${agent}" is not an agent in this repo.`)
  console.error(`Agents: ${AGENT_SLUGS.join(', ')}`)
  process.exit(1)
}

const readIfPresent = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8').catch(() => null)

const now = new Date()
const sessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID || null
const isRemote = process.env.CLAUDE_CODE_REMOTE === 'true'
const runId = workflow ? `${runIdFor(agent, now)}-${workflow}` : runIdFor(agent, now)

// The owner's clock, from shared/about-me.md. See lib/local-time.mjs for why UTC was wrong.
const tz = timeZoneFrom(await readIfPresent('shared/about-me.md'))
const local = localParts(now, tz)

// Every remote run used to be written down as `schedule`, a Run now included, because the two
// look identical from inside the session. The workflow's schedule settles it when the owner's
// time zone is known: nothing was due at this minute, so a person pressed the button. Without a
// workflow, a readable schedule or a time zone there is nothing to compare, and it stays as before.
let trigger = isRemote ? 'schedule' : 'manual'
if (isRemote && workflow && tz) {
  const source = await readIfPresent(`workflows/${workflow}.yml`)
  const schedule = source ? parseWorkflow(source)?.trigger?.schedule : null
  if (firedBySchedule(schedule, local) === false) trigger = 'manual'
}

const facts = {
  started_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  trigger,
  session_id: sessionId,
  session_url: sessionId ? `https://claude.ai/code/session_${sessionId}` : null,
  run_id: runId,
  path: `${monthFolderFor(now)}/${runId}.json`,
  date: local.date,
  timezone: tz ? tz.label : 'UTC (shared/about-me.md names no time zone)'
}

for (const [field, value] of Object.entries(facts)) {
  console.log(`${field.padEnd(12)} ${value === null ? 'null' : value}`)
}

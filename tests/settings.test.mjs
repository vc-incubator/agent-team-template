import test from 'node:test'
import assert from 'node:assert/strict'
import { read } from './helpers/repo.mjs'

const ALLOWED_MODELS = ['opus', 'sonnet', 'haiku']
const ALLOWED_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max']

async function settings() {
  return JSON.parse(await read('.claude/settings.json'))
}

test('model is an alias, never a pinned id', async () => {
  const config = await settings()
  assert.ok(
    ALLOWED_MODELS.includes(config.model),
    `model was "${config.model}" — use an alias from ${ALLOWED_MODELS.join(', ')}`
  )
  assert.doesNotMatch(config.model, /claude-|-\d/, 'a pinned model id rots; aliases upgrade themselves')
})

test('effortLevel is set and valid', async () => {
  const config = await settings()
  assert.ok(ALLOWED_EFFORT.includes(config.effortLevel), `effortLevel was "${config.effortLevel}"`)
})

test('thinking is never disabled', async () => {
  const raw = await read('.claude/settings.json')
  assert.doesNotMatch(
    raw,
    /"thinking"\s*:\s*(false|"off"|"disabled")/,
    'Opus 5 emits tool calls as plain text when thinking is off — lower effort instead'
  )
})

test('reading a .env file is denied', async () => {
  const config = await settings()
  const deny = config.permissions?.deny ?? []
  for (const rule of ['Read(**/.env)', 'Read(**/.env.*)', 'Edit(**/.env)']) {
    assert.ok(deny.includes(rule), `permissions.deny is missing ${rule}`)
  }
})

/* "Never sends" was an instruction, not a lock. The README called it "structural, not a setting",
   but the Gmail connector exposes send, reply and forward tools, a routine gets every connector
   with writes by default, and nothing denied them (agent-team-template TESTING.md T1, S3-13b).
   These rules make the claim true. The glob covers the same connector under both of its names:
   `mcp__Gmail__send_message` in a routine, `mcp__claude_ai_Gmail__send_message` in a local
   session. That a routine applies this file's deny rules is shown by a scheduled run on
   2026-09-27, refused a read of .env.example by this same list's .env rule. */

const SENDS = [
  'mcp__Gmail__send_message', 'mcp__claude_ai_Gmail__send_message',
  'mcp__Gmail__reply', 'mcp__claude_ai_Gmail__reply',
  'mcp__Gmail__forward', 'mcp__claude_ai_Gmail__forward',
  'mcp__Gmail__trash_thread', 'mcp__claude_ai_Gmail__delete_draft',
  'mcp__n8n__publish_workflow', 'mcp__claude_ai_ClickUp__clickup_delete_task'
]
const DRAFTS = ['mcp__Gmail__create_draft', 'mcp__Gmail__search_threads', 'mcp__Gmail__label_thread', 'mcp__Gmail__get_thread',
  'mcp__claude_ai_n8n__unpublish_workflow', 'mcp__Gmail__list_labels']

// The documented semantics: a glob in the tool-name position must match the whole tool name.
const matches = (rule, tool) =>
  new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(tool)

test('every connector\'s send, reply, forward, publish, delete and trash tools are denied', async () => {
  const deny = ((await settings()).permissions?.deny ?? []).filter((rule) => rule.startsWith('mcp__'))
  for (const tool of SENDS) {
    assert.ok(deny.some((rule) => matches(rule, tool)), `${tool} is not denied, so an agent can call it`)
  }
})

test('drafting, reading and labelling stay allowed', async () => {
  const deny = ((await settings()).permissions?.deny ?? []).filter((rule) => rule.startsWith('mcp__'))
  for (const tool of DRAFTS) {
    assert.ok(!deny.some((rule) => matches(rule, tool)), `${tool} is denied, and the jobs depend on it`)
  }
})

test('no MCP deny rule has parentheses, which a settings file skips', async () => {
  const deny = (await settings()).permissions?.deny ?? []
  assert.deepEqual(deny.filter((rule) => rule.startsWith('mcp__') && rule.includes('(')), [])
})

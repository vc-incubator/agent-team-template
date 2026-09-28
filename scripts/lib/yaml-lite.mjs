// A deliberately small YAML subset, in the spirit of frontmatter.mjs: flat keys, one level of
// nesting, inline `[a, b]` or dashed lists. Anything richer is a sign a config file is drifting
// away from something a person can read at a glance — and every file this parses is one a
// student is meant to be able to read.
//
// Shared by workflows/*.yml, tiles.yml and runtimes.yml so there is one parser to trust.

function scalar(raw) {
  const value = raw.trim()
  if (value === '') return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if (/^-?\d+$/.test(value)) return Number(value)
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value)
  if (quoted) return quoted[1] === "'" ? quoted[2].replaceAll("''", "'") : quoted[2]
  return value
}

// Split on commas, except inside a quoted item, so an owner's own sentence in a done block
// keeps its commas. A quote only opens at the start of an item, so client's stays plain text,
// and inside single quotes '' is a literal apostrophe, as in YAML proper. An unquoted item
// still splits on every comma, which is also what YAML does.
function splitItems(inner) {
  const items = []
  let current = ''
  let quote = null
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]
    if (quote) {
      current += char
      if (char === quote) {
        if (quote === "'" && inner[i + 1] === "'") current += inner[++i]
        else quote = null
      }
    } else if ((char === '"' || char === "'") && current.trim() === '') {
      quote = char
      current += char
    } else if (char === ',') {
      items.push(current)
      current = ''
    } else {
      current += char
    }
  }
  items.push(current)
  return items
}

function inlineList(raw) {
  const inner = raw.trim().slice(1, -1).trim()
  if (inner === '') return []
  return splitItems(inner).map((item) => scalar(item))
}

function isInline(rest) {
  const trimmed = rest.trim()
  return trimmed.startsWith('[') && trimmed.endsWith(']')
}

export function parseSimpleYaml(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const root = {}
  let openKey = null

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    // A dashed item belongs to whichever bare key opened most recently. Items can be plain
    // scalars or `- key: value` maps, which is how runtimes.yml lists entries.
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && openKey) {
      if (!Array.isArray(root[openKey])) root[openKey] = []
      const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(item[1])
      if (pair) root[openKey].push({ [pair[1]]: scalar(pair[2]) })
      else root[openKey].push(scalar(item[1]))
      continue
    }

    const pair = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!pair) continue
    const [, indent, key, rest] = pair

    if (indent !== '' && openKey) {
      const bucket = root[openKey]
      // Continuation of the last `- key: value` entry in a list, or a child of a bare map key.
      if (Array.isArray(bucket) && bucket.length && typeof bucket[bucket.length - 1] === 'object') {
        bucket[bucket.length - 1][key] = isInline(rest) ? inlineList(rest) : scalar(rest)
        continue
      }
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) root[openKey] = {}
      root[openKey][key] = isInline(rest) ? inlineList(rest) : scalar(rest)
      continue
    }

    if (rest === '') {
      // A bare key. The lines that follow decide whether it is a map or a list.
      openKey = key
      root[key] = {}
      continue
    }

    openKey = null
    root[key] = isInline(rest) ? inlineList(rest) : scalar(rest)
  }

  return root
}

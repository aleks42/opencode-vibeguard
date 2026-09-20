function subtractCovered(start, end, covered) {
  if (start >= end) return []
  const out = []
  let cur = start
  for (const c of covered) {
    if (c.end <= cur) continue
    if (c.start >= end) break
    if (c.start > cur) out.push({ start: cur, end: Math.min(c.start, end) })
    if (c.end >= end) {
      cur = end
      break
    }
    cur = Math.max(cur, c.end)
  }
  if (cur < end) out.push({ start: cur, end })
  return out
}

function insertCovered(covered, span) {
  if (span.start >= span.end) return covered
  let i = 0
  for (; i < covered.length; i++) {
    if (covered[i].start > span.start) break
  }
  covered.splice(i, 0, span)
  if (covered.length <= 1) return covered

  const merged = []
  for (const c of covered) {
    const last = merged.at(-1)
    if (!last) {
      merged.push(c)
      continue
    }
    if (c.start <= last.end) {
      if (c.end > last.end) last.end = c.end
      continue
    }
    merged.push(c)
  }
  return merged
}

/**
 * True when any context gate (string or RegExp) matches the window text.
 * @param {Array<string|RegExp>} context
 * @param {string} window
 */
function matchesContext(context, window) {
  for (const item of context) {
    if (item instanceof RegExp) {
      if (item.test(window)) return true
      continue
    }
    if (window.toLowerCase().includes(String(item).toLowerCase())) return true
  }
  return false
}

/**
 * Redact the input text and return the redacted text plus match info.
 * Design matches VibeGuard's redact engine: handles overlapping matches so that
 * placeholders are never split apart.
 * @param {string} input
 * @param {{ keywords: Array<{value:string,category:string}>, regex: Array<{pattern:string,flags:string,category:string}>, exclude: Set<string>, contextWindow?: number }} patterns
 * @param {{ getOrCreatePlaceholder(original: string, category: string): string }} session
 */
export function redactText(input, patterns, session) {
  const text = String(input ?? "")
  if (!text) return { text, matches: [] }

  const windowSize = Number.isFinite(patterns.contextWindow) ? patterns.contextWindow : 30
  const found = []

  for (const rule of patterns.keywords) {
    const needle = rule.value
    if (!needle) continue
    let idx = 0
    for (;;) {
      const pos = text.indexOf(needle, idx)
      if (pos === -1) break
      const start = pos
      const end = pos + needle.length
      const original = text.slice(start, end)
      idx = end
      if (patterns.exclude.has(original)) continue
      found.push({ start, end, original, category: rule.category })
    }
  }

  for (const rule of patterns.regex) {
    const baseFlags = String(rule.flags ?? "")
    const flags = baseFlags.includes("g") ? baseFlags : `${baseFlags}g`
    const re = new RegExp(rule.pattern, flags)
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue
      const start = m.index ?? -1
      if (start < 0) continue
      const end = start + m[0].length
      const original = text.slice(start, end)
      if (patterns.exclude.has(original)) continue
      // Checksum types: regex is loose, precision comes from validate (types
      // without a checksum simply omit this field)
      if (rule.validate && !rule.validate(original)) continue
      // Context-gated types: require a label within the window around the match
      if (rule.context) {
        const from = Math.max(0, start - windowSize)
        const to = Math.min(text.length, end + windowSize)
        const window = `${text.slice(from, start)}\n${text.slice(end, to)}`
        if (!matchesContext(rule.context, window)) continue
      }
      found.push({ start, end, original, category: rule.category, priority: rule.priority ?? 0 })
    }
  }

  if (found.length === 0) return { text, matches: [] }

  // Right-most first; on equal start, longer first, so a large left-side match
  // gets torn apart. Ties between rules on the same span go to the higher
  // priority (context-gated) rule.
  found.sort((a, b) => {
    if (a.start !== b.start) return b.start - a.start
    if (a.end !== b.end) return b.end - a.end
    return (b.priority ?? 0) - (a.priority ?? 0)
  })

  const planned = []
  let covered = []
  for (const m of found) {
    const segments = subtractCovered(m.start, m.end, covered)
    for (const seg of segments) {
      if (seg.start < 0 || seg.end > text.length || seg.start >= seg.end) continue
      planned.push({
        start: seg.start,
        end: seg.end,
        original: text.slice(seg.start, seg.end),
        category: m.category,
      })
      covered = insertCovered(covered, seg)
    }
  }

  planned.sort((a, b) => b.start - a.start)

  let out = text
  for (const m of planned) {
    const placeholder = session.getOrCreatePlaceholder(m.original, m.category)
    out = out.slice(0, m.start) + placeholder + out.slice(m.end)
    m.placeholder = placeholder
  }

  return { text: out, matches: planned }
}


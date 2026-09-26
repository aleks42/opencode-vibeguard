import { getPlaceholderRegex } from "./session.js"

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Extract the category from a placeholder without touching the original value.
 * @param {string} placeholder
 * @param {string} prefix
 */
function parseCategory(placeholder, prefix) {
  const re = new RegExp(`^${escapeRegex(prefix)}(.+)_[a-f0-9A-F]{12}(?:_\\d+)?__$`)
  const m = re.exec(placeholder)
  return m ? m[1] : "TEXT"
}

/**
 * Restore placeholders in a string; placeholders not in the mapping are left as-is.
 * @param {string} input
 * @param {{ prefix: string, lookup(ph: string): string | undefined }} session
 * @param {(restored: { category: string, placeholder: string, start: number, end: number, original: string }) => void} [onRestore] optional restore collector; `original` is the real restored value (for DEBUG logging)
 */
export function restoreText(input, session, onRestore) {
  const text = String(input ?? "")
  if (!text) return text
  const re = getPlaceholderRegex(session.prefix)
  return text.replace(re, (ph, offset) => {
    const original = session.lookup(ph)
    if (original === undefined) return ph
    if (typeof onRestore === "function") {
      onRestore({
        category: parseCategory(ph, session.prefix),
        placeholder: ph,
        start: offset,
        end: offset + ph.length,
        original,
      })
    }
    return original
  })
}


import { restoreText } from "./restore.js"
import { redactText } from "./engine.js"

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function childPath(base, key) {
  return base ? `${base}.${key}` : String(key)
}

function indexPath(base, index) {
  return `${base}[${index}]`
}

/**
 * Deep-walk a tool-args object and restore placeholders to original values in
 * every string (in place).
 * - Only walks Array / PlainObject
 * - Uses a WeakSet to avoid blowing the stack on cyclic references
 * @param {unknown} value
 * @param {{ prefix: string, lookup(ph: string): string | undefined }} session
 * @param {(restored: { category: string, placeholder: string, start: number, end: number, field: string, original: string }) => void} [onRestore] optional restore collector (for DEBUG logging)
 * @param {string} [pathPrefix] label prepended to every reported field path
 */
export function restoreDeep(value, session, onRestore, pathPrefix = "") {
  const seen = new WeakSet()
  const collect = (field) =>
    typeof onRestore === "function" ? (restored) => onRestore({ ...restored, field }) : undefined

  const walk = (node, nodePath) => {
    if (!node || typeof node !== "object") return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i]
        const path = indexPath(nodePath, i)
        if (typeof v === "string") node[i] = restoreText(v, session, collect(path))
        if (v && typeof v === "object") walk(v, path)
      }
      return
    }

    if (!isPlainObject(node)) return

    for (const key of Object.keys(node)) {
      const v = node[key]
      const path = childPath(nodePath, key)
      if (typeof v === "string") node[key] = restoreText(v, session, collect(path))
      if (v && typeof v === "object") walk(v, path)
    }
  }

  walk(value, pathPrefix)
}

/**
 * Deep-walk an object and replace sensitive content in every string with
 * placeholders (in place).
 * - Only walks Array / PlainObject
 * - Uses a WeakSet to avoid blowing the stack on cyclic references
 * @param {unknown} value
 * @param {{ keywords: Array<{value:string,category:string}>, regex: Array<{pattern:string,flags:string,category:string}>, exclude: Array<RegExp> }} patterns
 * @param {{ getOrCreatePlaceholder(original: string, category: string): string }} session
 * @param {(match: { category: string, placeholder: string, start: number, end: number, field: string, original: string }) => void} [onMatch] optional match collector (for DEBUG logging)
 * @param {string} [pathPrefix] label prepended to every reported field path
 */
export function redactDeep(value, patterns, session, onMatch, pathPrefix = "") {
  const seen = new WeakSet()
  const collect = (field) =>
    typeof onMatch === "function" ? (match) => onMatch({ ...match, field }) : undefined

  const walk = (node, nodePath) => {
    if (!node || typeof node !== "object") return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i]
        const path = indexPath(nodePath, i)
        if (typeof v === "string") node[i] = redactText(v, patterns, session, collect(path)).text
        if (v && typeof v === "object") walk(v, path)
      }
      return
    }

    if (!isPlainObject(node)) return

    for (const key of Object.keys(node)) {
      const v = node[key]
      const path = childPath(nodePath, key)
      if (typeof v === "string") node[key] = redactText(v, patterns, session, collect(path)).text
      if (v && typeof v === "object") walk(v, path)
    }
  }

  walk(value, pathPrefix)
}

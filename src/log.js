import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const DEFAULT_RETENTION_DAYS = 90
const DAILY_FILE_RE = /^vibeguard-(\d{4})-(\d{2})-(\d{2})\.log$/

/**
 * opencode data dir is `xdgData/opencode` and logs live in `<data>/log`
 * (see packages/core/src/global.ts). `xdgData` comes from the xdg-basedir
 * package: `XDG_DATA_HOME || ~/.local/share`. Replicating that formula keeps
 * the plugin log next to opencode.log on every platform.
 */
export function resolveLogDir() {
  const env = process.env.XDG_DATA_HOME
  const base = env && env.trim() ? env : path.join(os.homedir(), ".local", "share")
  return path.join(base, "opencode", "log")
}

function pad(value) {
  return String(value).padStart(2, "0")
}

function localDate(nowMs) {
  const d = new Date(nowMs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatValue(value) {
  const s = String(value)
  if (s === "") return '""'
  return /^[^\s"=\\]+$/.test(s) ? s : JSON.stringify(s)
}

// `source` and `session` are always reported last, regardless of caller order.
const TRAILING_KEYS = ["source", "session"]

function formatLine(level, message, extra, nowMs) {
  const parts = [
    new Date(nowMs).toISOString(),
    level,
    formatValue(message),
  ]
  if (extra && typeof extra === "object") {
    for (const key of Object.keys(extra)) {
      if (TRAILING_KEYS.includes(key)) continue
      const value = extra[key]
      if (value === undefined || value === null) continue
      if (key === "mapping" && Array.isArray(value)) {
        // Bare `left -> right` pair (no `key=`), e.g. a redact/restore match.
        parts.push(`${formatValue(value[0])} -> ${formatValue(value[1])}`)
        continue
      }
      parts.push(`${key}=${formatValue(value)}`)
    }
    for (const key of TRAILING_KEYS) {
      const value = extra[key]
      if (value === undefined || value === null) continue
      parts.push(`${key}=${formatValue(value)}`)
    }
  }
  return `${parts.join(" ")}\n`
}

/**
 * File logger for the plugin.
 * - Writes `vibeguard-<YYYY-MM-DD>.log` next to `opencode.log` (daily rotation,
 *   the date is recomputed on every write so a long-lived process rolls over).
 * - `file` overrides the name (disables daily rotation and retention).
 * - Deletes own `vibeguard-*.log` files older than `retentionDays` (0 = keep).
 * - Never throws: logging must not break the plugin hooks.
 * - INFO lines carry metadata only. DEBUG lines may include the real match as a
 *   bare `left -> right` pair, so a debug log file holds secrets/PII in plaintext.
 *
 * @param {{ enabled?: boolean, level?: "info"|"debug", file?: string|null, retentionDays?: number, now?: () => number }} options
 */
export function createLogger(options = {}) {
  const enabled = options.enabled !== false
  const level = options.level === "debug" ? "debug" : "info"
  const file = typeof options.file === "string" && options.file ? options.file : null
  const retentionDays =
    Number.isFinite(options.retentionDays) && options.retentionDays >= 0
      ? Number(options.retentionDays)
      : DEFAULT_RETENTION_DAYS
  const now = typeof options.now === "function" ? options.now : Date.now

  let lastRetentionDate = ""

  const resolveFile = (nowMs) => {
    if (file) return file
    return path.join(resolveLogDir(), `vibeguard-${localDate(nowMs)}.log`)
  }

  const ensureDir = (target) => {
    try {
      mkdirSync(path.dirname(target), { recursive: true })
    } catch {
      // ignore: the write attempt below will simply fail and be swallowed
    }
  }

  const runRetention = (nowMs) => {
    if (!enabled || file || retentionDays <= 0) return
    const today = localDate(nowMs)
    if (lastRetentionDate === today) return
    lastRetentionDate = today

    const dir = resolveLogDir()
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    const cutoff = localDate(nowMs - retentionDays * 24 * 60 * 60 * 1000)
    for (const name of entries) {
      const m = DAILY_FILE_RE.exec(name)
      if (!m) continue
      const fileDate = `${m[1]}-${m[2]}-${m[3]}`
      if (fileDate >= cutoff) continue
      try {
        unlinkSync(path.join(dir, name))
      } catch {
        // ignore
      }
    }
  }

  const write = (logLevel, message, extra) => {
    if (!enabled) return
    const nowMs = now()
    const target = resolveFile(nowMs)
    ensureDir(target)
    runRetention(nowMs)
    try {
      appendFileSync(target, formatLine(logLevel, message, extra, nowMs))
    } catch {
      // ignore: logging is best-effort
    }
  }

  runRetention(now())

  return {
    enabled,
    level,
    get path() {
      return resolveFile(now())
    },
    info(message, extra) {
      write("INFO", message, extra)
    },
    debug(message, extra) {
      if (level !== "debug") return
      write("DEBUG", message, extra)
    },
  }
}

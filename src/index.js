import { loadConfig } from "./config.js"
import { buildPatternSet } from "./patterns.js"
import { PlaceholderSession } from "./session.js"
import { redactText } from "./engine.js"
import { redactDeep, restoreDeep } from "./deep.js"
import { restoreText } from "./restore.js"
import { createLogger } from "./log.js"

/**
 * Tool input fields that are safe to record as a source hint. Never includes
 * free-form payloads (command/content/newString) which may themselves hold secrets.
 */
const SAFE_INPUT_KEYS = ["filePath", "path", "pattern", "glob", "include", "query"]

function pickSafeInput(input) {
  const out = {}
  if (input && typeof input === "object") {
    for (const key of SAFE_INPUT_KEYS) {
      const value = input[key]
      if (typeof value === "string" && value) out[key] = value
    }
  }
  return out
}

function formatCategories(categories) {
  return [...categories.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([name, count]) => `${name}:${count}`)
    .join(",")
}

function bumpCategory(categories, category) {
  categories.set(category, (categories.get(category) ?? 0) + 1)
}

/**
 * OpenCode plugin entrypoint:
 * - `experimental.chat.messages.transform`: redact all messages before the LLM request (the provider never sees real values)
 * - `tool.execute.before`: restore placeholders before tool execution (local execution gets the real values)
 *
 * NOTE: to reduce the risk of misuse, this plugin is a no-op when no config file is found or `enabled=false`.
 */
export const VibeGuardPrivacy = async (ctx) => {
  const config = await loadConfig(ctx.directory)

  if (!config.enabled) return {}

  const patterns = buildPatternSet(config.patterns)
  const sessions = new Map()
  const logger = createLogger({
    enabled: config.log.enabled,
    level: config.log.level,
    file: config.log.file,
    retentionDays: config.log.retentionDays,
  })

  logger.info("initialized", {
    config: config.loadedFrom || "unknown",
    log_level: logger.level,
    log: logger.path,
  })

  const getSession = (sessionID) => {
    const key = String(sessionID ?? "")
    if (!key) return null
    const existing = sessions.get(key)
    if (existing) return existing
    const created = new PlaceholderSession({
      prefix: config.prefix,
      ttlMs: config.ttlMs,
      maxMappings: config.maxMappings,
    })
    sessions.set(key, created)
    return created
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const msgs = output?.messages
      if (!Array.isArray(msgs) || msgs.length === 0) return

      const sessionID = msgs[0]?.info?.sessionID ?? msgs[0]?.parts?.[0]?.sessionID
      const session = getSession(sessionID)
      if (!session) return

      session.cleanup()

      const summary = { redacted: 0, parts: 0, categories: new Map() }

      const track = (source, base) => (match) => {
        summary.redacted++
        bumpCategory(summary.categories, match.category)
        logger.debug("match", {
          session: sessionID,
          category: match.category,
          mapping: [match.original, match.placeholder],
          source,
          ...base,
          ...(match.field ? { field: match.field } : {}),
          offset: match.start,
          len: match.end - match.start,
        })
      }

      for (const msg of msgs) {
        const role = msg?.info?.role ?? "unknown"
        const parts = Array.isArray(msg?.parts) ? msg.parts : []
        for (const part of parts) {
          if (!part) continue

          // Plain text (user/assistant)
          if (part.type === "text") {
            if (part.ignored) continue
            if (!part.text || typeof part.text !== "string") continue
            const before = summary.redacted
            part.text = redactText(part.text, patterns, session, track(`text:${role}`)).text
            if (summary.redacted > before) summary.parts++
            continue
          }

          // Reasoning text (some models/configs feed it into the prompt)
          if (part.type === "reasoning") {
            if (!part.text || typeof part.text !== "string") continue
            const before = summary.redacted
            part.text = redactText(part.text, patterns, session, track(`reasoning:${role}`)).text
            if (summary.redacted > before) summary.parts++
            continue
          }

          // Tool calls/output: the most common leak source (e.g. reading .env)
          if (part.type === "tool") {
            const state = part.state
            if (!state || typeof state !== "object") continue

            const tool = part.tool ?? "tool"
            const base = pickSafeInput(state.input)

            // Deep-redact tool input as well: the real executed args contain plaintext
            // (restored by tool.execute.before). Without redacting here again, later
            // turns would send the plaintext args to the LLM.
            if (state.input && typeof state.input === "object") {
              const before = summary.redacted
              redactDeep(state.input, patterns, session, track(`tool:${tool}`, base))
              if (summary.redacted > before) summary.parts++
            }

            if (state.status === "completed" && typeof state.output === "string") {
              const before = summary.redacted
              state.output = redactText(
                state.output,
                patterns,
                session,
                track(`tool:${tool}`, { ...base, stream: "output" }),
              ).text
              if (summary.redacted > before) summary.parts++
              continue
            }
            if (state.status === "error" && typeof state.error === "string") {
              const before = summary.redacted
              state.error = redactText(
                state.error,
                patterns,
                session,
                track(`tool:${tool}`, { ...base, stream: "error" }),
              ).text
              if (summary.redacted > before) summary.parts++
              continue
            }
            if (state.status === "pending" && typeof state.raw === "string") {
              const before = summary.redacted
              state.raw = redactText(
                state.raw,
                patterns,
                session,
                track(`tool:${tool}`, { ...base, stream: "raw" }),
              ).text
              if (summary.redacted > before) summary.parts++
              continue
            }
          }
        }
      }

      if (summary.redacted > 0) {
        logger.info("redacted", {
          session: sessionID,
          redacted: summary.redacted,
          parts: summary.parts,
          categories: formatCategories(summary.categories),
        })
      }
    },

    "experimental.text.complete": async (input, output) => {
      if (!output || typeof output !== "object") return
      if (typeof output.text !== "string" || !output.text) return
      const session = getSession(input?.sessionID)
      if (!session) return
      session.cleanup()

      const summary = { restored: 0, categories: new Map() }
      const track = (restored) => {
        summary.restored++
        bumpCategory(summary.categories, restored.category)
        logger.debug("restore", {
          session: input?.sessionID,
          category: restored.category,
          mapping: [restored.placeholder, restored.original],
          source: "text:assistant",
          offset: restored.start,
          len: restored.end - restored.start,
        })
      }

      output.text = restoreText(output.text, session, track)

      if (summary.restored > 0) {
        logger.info("restored", {
          session: input?.sessionID,
          restored: summary.restored,
          source: "text:assistant",
          categories: formatCategories(summary.categories),
        })
      }
    },

    "tool.execute.before": async (input, output) => {
      const session = getSession(input?.sessionID)
      if (!session) return
      session.cleanup()

      const tool = input?.tool ?? "tool"
      const summary = { restored: 0, categories: new Map() }
      const track = (restored) => {
        summary.restored++
        bumpCategory(summary.categories, restored.category)
        logger.debug("restore", {
          session: input?.sessionID,
          category: restored.category,
          mapping: [restored.placeholder, restored.original],
          source: `tool:${tool}`,
          field: restored.field,
          offset: restored.start,
          len: restored.end - restored.start,
        })
      }

      restoreDeep(output?.args, session, track)

      if (summary.restored > 0) {
        logger.info("restored", {
          session: input?.sessionID,
          restored: summary.restored,
          source: `tool:${tool}`,
          categories: formatCategories(summary.categories),
        })
      }
    },
  }
}

import { loadConfig } from "./config.js"
import { buildPatternSet } from "./patterns.js"
import { PlaceholderSession } from "./session.js"
import { redactText } from "./engine.js"
import { redactDeep, restoreDeep } from "./deep.js"
import { restoreText } from "./restore.js"

/**
 * OpenCode plugin entrypoint:
 * - `experimental.chat.messages.transform`: redact all messages before the LLM request (the provider never sees real values)
 * - `tool.execute.before`: restore placeholders before tool execution (local execution gets the real values)
 *
 * NOTE: to reduce the risk of misuse, this plugin is a no-op when no config file is found or `enabled=false`.
 */
export const VibeGuardPrivacy = async (ctx) => {
  const config = await loadConfig(ctx.directory)
  const debug = Boolean(process.env.OPENCODE_VIBEGUARD_DEBUG) || Boolean(config.debug)

  if (debug) {
    const from = config.loadedFrom ? config.loadedFrom : "not found (plugin will no-op)"
    console.log(`[opencode-vibeguard] config: ${from} enabled=${config.enabled}`)
  }

  if (!config.enabled) return {}

  const patterns = buildPatternSet(config.patterns)
  const sessions = new Map()

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

      let changedTextParts = 0

      for (const msg of msgs) {
        const parts = Array.isArray(msg?.parts) ? msg.parts : []
        for (const part of parts) {
          if (!part) continue

          // Plain text (user/assistant)
          if (part.type === "text") {
            if (part.ignored) continue
            if (!part.text || typeof part.text !== "string") continue
            const before = part.text
            const after = redactText(before, patterns, session).text
            if (after !== before) changedTextParts++
            part.text = after
            continue
          }

          // Reasoning text (some models/configs feed it into the prompt)
          if (part.type === "reasoning") {
            if (!part.text || typeof part.text !== "string") continue
            const before = part.text
            const after = redactText(before, patterns, session).text
            if (after !== before) changedTextParts++
            part.text = after
            continue
          }

          // Tool calls/output: the most common leak source (e.g. reading .env)
          if (part.type === "tool") {
            const state = part.state
            if (!state || typeof state !== "object") continue

            // Deep-redact tool input as well: the real executed args contain plaintext
            // (restored by tool.execute.before). Without redacting here again, later
            // turns would send the plaintext args to the LLM.
            if (state.input && typeof state.input === "object") {
              redactDeep(state.input, patterns, session)
            }

            if (state.status === "completed" && typeof state.output === "string") {
              const before = state.output
              const after = redactText(before, patterns, session).text
              if (after !== before) changedTextParts++
              state.output = after
              continue
            }
            if (state.status === "error" && typeof state.error === "string") {
              const before = state.error
              const after = redactText(before, patterns, session).text
              if (after !== before) changedTextParts++
              state.error = after
              continue
            }
            if (state.status === "pending" && typeof state.raw === "string") {
              const before = state.raw
              const after = redactText(before, patterns, session).text
              if (after !== before) changedTextParts++
              state.raw = after
              continue
            }
          }
        }
      }

      if (debug && changedTextParts > 0) {
        console.log(`[opencode-vibeguard] redacted before request: ${changedTextParts} text segment(s) changed`)
      }
    },

    "experimental.text.complete": async (input, output) => {
      if (!output || typeof output !== "object") return
      if (typeof output.text !== "string" || !output.text) return
      const session = getSession(input?.sessionID)
      if (!session) return
      session.cleanup()
      const before = output.text
      const after = restoreText(before, session)
      output.text = after
      if (debug && after !== before) {
        console.log("[opencode-vibeguard] restored after response: 1 text segment changed")
      }
    },

    "tool.execute.before": async (input, output) => {
      const session = getSession(input?.sessionID)
      if (!session) return
      session.cleanup()
      restoreDeep(output?.args, session)
    },
  }
}

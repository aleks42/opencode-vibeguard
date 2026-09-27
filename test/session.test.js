import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { PlaceholderSession } from "../src/session.js"

const PLACEHOLDER_RE = /__VG_EMAIL_[a-f0-9]{12}__/

function makeSession() {
  return new PlaceholderSession({ prefix: "__VG_", ttlMs: 0, maxMappings: 1000 })
}

// Never write real values here: this repo may run with the plugin active and
// tool output is redacted. Build the probe at runtime instead.
function probeValue() {
  return ["john.doe", "corp.org"].join(String.fromCharCode(64))
}

test("same original maps to the same placeholder within one session", () => {
  const session = makeSession()
  const value = probeValue()

  const first = session.getOrCreatePlaceholder(value, "EMAIL")
  const second = session.getOrCreatePlaceholder(value, "EMAIL")

  assert.equal(first, second)
  assert.match(first, /^__VG_EMAIL_[a-f0-9]{12}__$/)
  assert.equal(session.lookup(first), value)
})

test("same original maps to different placeholders across sessions", () => {
  const value = probeValue()

  const a = makeSession().getOrCreatePlaceholder(value, "EMAIL")
  const b = makeSession().getOrCreatePlaceholder(value, "EMAIL")

  assert.match(a, /^__VG_EMAIL_[a-f0-9]{12}__$/)
  assert.match(b, /^__VG_EMAIL_[a-f0-9]{12}__$/)
  assert.notEqual(a, b, "the same value must not be correlatable across sessions")
})

test("different originals map to different placeholders in one session", () => {
  const session = makeSession()
  const one = ["john.doe", "corp.org"].join(String.fromCharCode(64))
  const two = ["jane.doe", "corp.org"].join(String.fromCharCode(64))

  const a = session.getOrCreatePlaceholder(one, "EMAIL")
  const b = session.getOrCreatePlaceholder(two, "EMAIL")

  assert.notEqual(a, b)
})

test("plugin keeps a session stable and rotates the placeholder across sessions", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vibeguard-session-"))
  const previousConfig = process.env.OPENCODE_VIBEGUARD_CONFIG
  const previousData = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = root
  try {
    const configPath = path.join(root, "vibeguard.config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        enabled: true,
        log: { enabled: false },
        patterns: { builtin: ["email"], exclude: [] },
      }),
      "utf8",
    )
    process.env.OPENCODE_VIBEGUARD_CONFIG = configPath

    const { VibeGuardPrivacy } = await import("../src/index.js")
    const hooks = await VibeGuardPrivacy({ directory: root })
    const transform = hooks["experimental.chat.messages.transform"]

    const value = probeValue()
    const redact = async (sessionID) => {
      const messages = [
        {
          info: { sessionID, role: "user" },
          parts: [{ type: "text", text: `contact ${value} please` }],
        },
      ]
      await transform({}, { messages })
      const out = messages[0].parts[0].text
      const m = PLACEHOLDER_RE.exec(out)
      assert.ok(m, `expected a placeholder for ${sessionID}`)
      return m[0]
    }

    const firstA = await redact("ses_a")
    const firstB = await redact("ses_b")
    const secondA = await redact("ses_a")

    assert.equal(firstA, secondA, "same session must keep the same placeholder")
    assert.notEqual(firstA, firstB, "different sessions must not share a placeholder")
  } finally {
    if (previousConfig === undefined) delete process.env.OPENCODE_VIBEGUARD_CONFIG
    else process.env.OPENCODE_VIBEGUARD_CONFIG = previousConfig
    if (previousData === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previousData
    rmSync(root, { recursive: true, force: true })
  }
})

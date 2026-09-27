import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { createLogger, resolveLogDir } from "../src/log.js"

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "vibeguard-log-"))
}

function pad(value) {
  return String(value).padStart(2, "0")
}

function localDate(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : ""
}

test("writes next to opencode.log using the opencode data dir", () => {
  const root = tempDir()
  const previous = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = root
  try {
    const logDir = path.join(root, "opencode", "log")
    mkdirSync(logDir, { recursive: true })
    writeFileSync(path.join(logDir, "opencode.log"), "sentinel", "utf8")

    const logger = createLogger({ level: "info" })
    logger.info("redacted", { redacted: 1, categories: "EMAIL:1" })

    assert.equal(resolveLogDir(), logDir)
    const file = path.join(logDir, `vibeguard-${localDate(Date.now())}.log`)
    assert.ok(existsSync(file), "plugin log file should exist")
    const content = readFileSync(file, "utf8")
    assert.match(content, /^\d{4}-\d{2}-\d{2}T\S+ INFO redacted\b/m)
    assert.doesNotMatch(content, /timestamp=|service=|level=/)
    assert.equal(readFileSync(path.join(logDir, "opencode.log"), "utf8"), "sentinel")
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("rotates to a new file when the date changes", () => {
  const root = tempDir()
  const previous = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = root
  try {
    let clock = new Date("2026-09-26T10:00:00").getTime()
    const logger = createLogger({ level: "info", now: () => clock })
    logger.info("redacted", { redacted: 1 })

    clock = new Date("2026-09-27T00:05:00").getTime()
    logger.info("redacted", { redacted: 2 })

    const logDir = path.join(root, "opencode", "log")
    const files = readdirSync(logDir).sort()
    assert.deepEqual(files, ["vibeguard-2026-09-26.log", "vibeguard-2026-09-27.log"])
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("retention deletes only its own old files", () => {
  const root = tempDir()
  const previous = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = root
  try {
    const logDir = path.join(root, "opencode", "log")
    mkdirSync(logDir, { recursive: true })
    const now = new Date("2026-09-26T12:00:00").getTime()

    writeFileSync(path.join(logDir, "vibeguard-2026-01-01.log"), "old", "utf8")
    writeFileSync(path.join(logDir, "vibeguard-2026-09-01.log"), "fresh", "utf8")
    writeFileSync(path.join(logDir, "vibeguard-not-a-date.log"), "junk", "utf8")
    writeFileSync(path.join(logDir, "opencode.log"), "sentinel", "utf8")

    createLogger({ level: "info", now: () => now, retentionDays: 90 })

    assert.equal(existsSync(path.join(logDir, "vibeguard-2026-01-01.log")), false)
    assert.equal(existsSync(path.join(logDir, "vibeguard-2026-09-01.log")), true)
    assert.equal(existsSync(path.join(logDir, "vibeguard-not-a-date.log")), true)
    assert.equal(existsSync(path.join(logDir, "opencode.log")), true)
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("retention_days 0 keeps everything", () => {
  const root = tempDir()
  const previous = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = root
  try {
    const logDir = path.join(root, "opencode", "log")
    mkdirSync(logDir, { recursive: true })
    const old = path.join(logDir, "vibeguard-2000-01-01.log")
    writeFileSync(old, "old", "utf8")

    createLogger({ level: "info", retentionDays: 0 })

    assert.equal(existsSync(old), true)
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("levels: info suppresses match detail, debug emits it", () => {
  const root = tempDir()
  const previous = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = root
  try {
    const infoLogger = createLogger({ level: "info" })
    infoLogger.info("redacted", { redacted: 1 })
    infoLogger.debug("match", { category: "EMAIL" })

    const detail = path.join(root, "opencode", "log", `vibeguard-${localDate(Date.now())}.log`)
    const content = readFileSync(detail, "utf8")
    assert.match(content, /\bINFO redacted\b/)
    assert.doesNotMatch(content, /\bmatch\b/)

    const debugLogger = createLogger({ level: "debug" })
    debugLogger.debug("match", { category: "EMAIL", placeholder: "__VG_EMAIL_deadbeef1234__" })
    const debugContent = readFileSync(detail, "utf8")
    assert.match(debugContent, /\bDEBUG match category=EMAIL\b/)
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("write failures are swallowed", () => {
  const root = tempDir()
  const previous = process.env.XDG_DATA_HOME
  try {
    const asFile = path.join(root, "not-a-dir")
    writeFileSync(asFile, "x", "utf8")
    process.env.XDG_DATA_HOME = asFile

    const logger = createLogger({ level: "debug" })
    assert.doesNotThrow(() => {
      logger.info("redacted", { redacted: 1 })
      logger.debug("match", { category: "EMAIL" })
    })
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("plugin end-to-end: debug logs metadata and the plaintext secret", async () => {
  const root = tempDir()
  const previousData = process.env.XDG_DATA_HOME
  const previousConfig = process.env.OPENCODE_VIBEGUARD_CONFIG
  process.env.XDG_DATA_HOME = root
  try {
    const configPath = path.join(root, "vibeguard.config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        enabled: true,
        log: { enabled: true, level: "debug", file: null, retention_days: 90 },
        patterns: { exclude: [] },
      }),
      "utf8",
    )
    process.env.OPENCODE_VIBEGUARD_CONFIG = configPath

    const { VibeGuardPrivacy } = await import("../src/index.js")
    const hooks = await VibeGuardPrivacy({ directory: root })

    const secret = ["john.doe", "corp.org"].join(String.fromCharCode(64))
    const messages = [
      {
        info: { sessionID: "ses_test", role: "user" },
        parts: [{ type: "text", text: `contact ${secret} please` }],
      },
      {
        info: { sessionID: "ses_test", role: "tool" },
        parts: [
          {
            type: "tool",
            tool: "read",
            state: {
              status: "completed",
              input: { filePath: "src/.env" },
              output: `EMAIL=${secret}`,
            },
          },
        ],
      },
    ]

    await hooks["experimental.chat.messages.transform"]({}, { messages })

    const file = path.join(root, "opencode", "log", `vibeguard-${localDate(Date.now())}.log`)
    let content = readFileSync(file, "utf8")

    const real = secret.replace(/\./g, "\\.")
    assert.match(content, new RegExp(`${real} -> __VG_EMAIL_[a-f0-9]{12}__`), "debug log records the real value")
    assert.match(content, /categories=EMAIL:2/)
    assert.match(content, /filePath=src\/\.env .* offset=\d+ len=\d+ source=tool:read session=ses_test/)
    assert.match(content, /\bDEBUG match\b/)
    assert.doesNotMatch(content, /placeholder=|plain=/)

    const placeholder = messages[0].parts[0].text.match(/__VG_EMAIL_[a-f0-9]{12}__/)[0]
    await hooks["experimental.text.complete"]({ sessionID: "ses_test" }, { text: placeholder })
    content = readFileSync(file, "utf8")
    assert.match(content, new RegExp(`${placeholder} -> ${real}`), "restore logs the inverse mapping")
    assert.match(content, /source=text:assistant session=ses_test/)
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previousData
    if (previousConfig === undefined) delete process.env.OPENCODE_VIBEGUARD_CONFIG
    else process.env.OPENCODE_VIBEGUARD_CONFIG = previousConfig
    rmSync(root, { recursive: true, force: true })
  }
})

test("plugin end-to-end: info level never logs the plaintext secret", async () => {
  const root = tempDir()
  const previousData = process.env.XDG_DATA_HOME
  const previousConfig = process.env.OPENCODE_VIBEGUARD_CONFIG
  process.env.XDG_DATA_HOME = root
  try {
    const configPath = path.join(root, "vibeguard.config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        enabled: true,
        log: { enabled: true, level: "info", file: null, retention_days: 90 },
        patterns: { exclude: [] },
      }),
      "utf8",
    )
    process.env.OPENCODE_VIBEGUARD_CONFIG = configPath

    const { VibeGuardPrivacy } = await import("../src/index.js")
    const hooks = await VibeGuardPrivacy({ directory: root })

    const secret = ["jane.doe", "corp.org"].join(String.fromCharCode(64))
    const messages = [
      {
        info: { sessionID: "ses_info", role: "user" },
        parts: [{ type: "text", text: `contact ${secret} please` }],
      },
    ]

    await hooks["experimental.chat.messages.transform"]({}, { messages })

    const file = path.join(root, "opencode", "log", `vibeguard-${localDate(Date.now())}.log`)
    const content = readFileSync(file, "utf8")

    assert.doesNotMatch(content, new RegExp(secret.replace(/\./g, "\\.")), "info log must not contain plaintext")
    assert.doesNotMatch(content, /plain=| -> /)
    assert.match(content, /\bINFO redacted\b/)
    assert.match(content, /session=ses_info\n/)
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previousData
    if (previousConfig === undefined) delete process.env.OPENCODE_VIBEGUARD_CONFIG
    else process.env.OPENCODE_VIBEGUARD_CONFIG = previousConfig
    rmSync(root, { recursive: true, force: true })
  }
})

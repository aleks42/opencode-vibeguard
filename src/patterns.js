function sanitizeCategory(input) {
  const raw = String(input ?? "").trim()
  if (!raw) return "TEXT"
  const upper = raw.toUpperCase()
  const safe = upper.replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_")
  if (!safe) return "TEXT"
  return safe
}

/**
 * Lightweight compatibility for Go-style `(?i)` / `(?m)` leading flags
 * (only handles consecutive occurrences at the start).
 * @param {string} pattern
 * @param {string} flags
 */
function peelInlineFlags(pattern, flags) {
  let p = String(pattern ?? "")
  let f = String(flags ?? "")

  for (;;) {
    if (p.startsWith("(?i)")) {
      p = p.slice(4)
      if (!f.includes("i")) f += "i"
      continue
    }
    if (p.startsWith("(?m)")) {
      p = p.slice(4)
      if (!f.includes("m")) f += "m"
      continue
    }
    break
  }

  return { pattern: p, flags: f }
}

function onlyDigits(input) {
  return String(input ?? "").replace(/\D/g, "")
}

/**
 * SNILS (Russian individual insurance account) validation: 11 digits, format `xxx-xxx-xxx xx`.
 * Handles checksum < 100, 100/101, and > 101 (mod 101, result 100 becomes 0).
 */
export function snils(input) {
  const d = onlyDigits(input)
  if (d.length !== 11) return false

  const check = Number(d.slice(9, 11))
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (9 - i)

  let expected
  if (sum < 100) expected = sum
  else if (sum === 100 || sum === 101) expected = 0
  else {
    expected = sum % 101
    if (expected === 100) expected = 0
  }

  return expected === check
}

function weightedSum(digits, weights) {
  let sum = 0
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i]
  return sum
}

/** 10-digit INN (Russian corporate tax ID). Enabled in iteration 2 with context. */
export function inn10(input) {
  const d = onlyDigits(input)
  if (d.length !== 10) return false
  const n = weightedSum(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11 % 10
  return n === Number(d[9])
}

/** 12-digit INN (Russian personal tax ID) with two check digits. */
export function inn12(input) {
  const d = onlyDigits(input)
  if (d.length !== 12) return false
  const n11 = weightedSum(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11 % 10
  if (n11 !== Number(d[10])) return false
  const n12 = weightedSum(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11 % 10
  return n12 === Number(d[11])
}

/**
 * IBAN validation: strip spaces, move the first 4 chars to the end, map letters
 * to digits (A=10..Z=35), then mod 97 == 1. Uses char-by-char modulo to avoid
 * big-integer dependencies.
 */
export function mod97(input) {
  const s = String(input ?? "").replace(/\s+/g, "").toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false

  const rearranged = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const code = ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55)
    for (const digit of code) rem = (rem * 10 + Number(digit)) % 97
  }
  return rem === 1
}

/** Brazilian CPF validation: two check digits, rejecting all-identical digits. */
export function cpf(input) {
  const d = onlyDigits(input)
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false

  const digit = (len) => {
    const r = (weightedSum(d, Array.from({ length: len }, (_, i) => len + 1 - i)) * 10) % 11
    return r === 10 ? 0 : r
  }

  return digit(9) === Number(d[9]) && digit(10) === Number(d[10])
}

/** Brazilian CNPJ validation: two check digits, rejecting all-identical digits. */
export function cnpj(input) {
  const d = onlyDigits(input)
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const digit = (weights) => {
    const r = weightedSum(d, weights) % 11
    return r < 2 ? 0 : 11 - r
  }

  return digit(w1) === Number(d[12]) && digit(w2) === Number(d[13])
}

/** Russian OGRN validation: first 12 digits mod 11, last digit is the remainder mod 10. */
export function ogrn13(input) {
  const d = onlyDigits(input)
  if (d.length !== 13) return false
  const n = Number(d.slice(0, 12)) % 11 % 10
  return n === Number(d[12])
}

/** Russian OGRNIP validation: first 14 digits mod 13, last digit is the remainder mod 10. */
export function ogrnip15(input) {
  const d = onlyDigits(input)
  if (d.length !== 15) return false
  const n = Number(d.slice(0, 14)) % 13 % 10
  return n === Number(d[14])
}

/** Polish PESEL validation: weighted checksum over the first 10 digits. */
export function pesel(input) {
  const d = onlyDigits(input)
  if (d.length !== 11) return false
  const sum = weightedSum(d, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3])
  return (10 - (sum % 10)) % 10 === Number(d[10])
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

/** Indian Aadhaar validation via the Verhoeff checksum (12 digits). */
export function verhoeff(input) {
  const d = onlyDigits(input)
  if (d.length !== 12) return false
  let c = 0
  const digits = d.split("").reverse().map(Number)
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]]
  return c === 0
}

/** US SSN structural validation: reject invalid area/group/serial ranges (no checksum exists). */
export function usSsn(input) {
  const m = String(input ?? "").trim().match(/^(\d{3})-(\d{2})-(\d{4})$/)
  if (!m) return false
  const area = Number(m[1])
  if (area === 0 || area === 666 || area >= 900) return false
  if (m[2] === "00" || m[3] === "0000") return false
  return true
}

/** Russian KPP structural shape: 4 digits, 2 alphanumerics, 3 digits. */
export function kpp(input) {
  return /^\d{4}[A-Z0-9]{2}\d{3}$/.test(String(input ?? "").trim().toUpperCase())
}

/** Validator set for tests and future iterations. */
export const validators = { snils, inn10, inn12, mod97, cpf, cnpj, ogrn13, ogrnip15, pesel, verhoeff, usSsn, kpp }

/**
 * Label gate builders for context-aware rules. Latin labels get word boundaries
 * so `INN` does not match inside e.g. `beginning`; native (Cyrillic) labels are
 * plain substrings matched case-insensitively by the engine.
 * NOTE: Cyrillic is allowed here only as label string literals.
 */
function labelContext(latin, native) {
  const parts = []
  for (const word of latin ?? []) {
    parts.push(new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, "i"))
  }
  for (const word of native ?? []) parts.push(word)
  return parts
}

/** Normalize a rule `context` into an array of strings/RegExps, or undefined. */
function normalizeContext(context) {
  if (!context) return undefined
  const items = Array.isArray(context) ? context : [context]
  const out = items.filter((x) => x instanceof RegExp || (typeof x === "string" && x.trim()))
  return out.length > 0 ? out : undefined
}

const INN_CONTEXT = labelContext(["INN"], ["ИНН"])
const OGRN_CONTEXT = labelContext(["OGRN"], ["ОГРН"])
const OGRNIP_CONTEXT = labelContext(["OGRNIP"], ["ОГРНИП"])
const PESEL_CONTEXT = labelContext(["PESEL"], [])
const AADHAAR_CONTEXT = labelContext(["Aadhaar", "UIDAI"], [])
const SSN_CONTEXT = labelContext(["SSN", "social security"], [])
const KPP_CONTEXT = labelContext(["KPP"], ["КПП"])
const PASSPORT_CONTEXT = labelContext(["passport"], ["паспорт", "серия"])

/**
 * Built-in rules: ported from VibeGuard's builtin rules (with JS compatibility
 * adjustments). The goal is "low config cost + broad coverage", not 100% precision.
 * `validate` is used for checksum types; the regex is intentionally loose and
 * precision comes from the validator.
 * `context` is an optional label gate (array of strings/RegExps); a match is kept
 * only when one of them appears within `context_window` chars around it.
 * A value may be a single rule object or an array of rules (multiple lengths/formats per type).
 */
const BUILTIN = new Map([
  [
    "email",
    {
      pattern: String.raw`[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}`,
      flags: "i",
      category: "EMAIL",
    },
  ],
  [
    "china_phone",
    {
      // Match the phone number itself (lookaround replaces Go's capture-group boundary approach)
      pattern: String.raw`(?<!\d)1[3-9]\d{9}(?!\d)`,
      flags: "",
      category: "CHINA_PHONE",
    },
  ],
  [
    "china_id",
    {
      pattern: String.raw`(?<!\d)\d{17}[\dXx](?!\d)`,
      flags: "",
      category: "CHINA_ID",
    },
  ],
  [
    "uuid",
    {
      pattern: String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}`,
      flags: "",
      category: "UUID",
    },
  ],
  [
    "ipv4",
    {
      // Does not validate each octet 0-255; the goal is to cover common cases
      pattern: String.raw`(?:\d{1,3}\.){3}\d{1,3}`,
      flags: "",
      category: "IPV4",
    },
  ],
  [
    "mac",
    {
      pattern: String.raw`(?:[0-9a-f]{2}:){5}[0-9a-f]{2}`,
      flags: "i",
      category: "MAC",
    },
  ],
  [
    "snils",
    {
      pattern: String.raw`\d{3}-\d{3}-\d{3} \d{2}`,
      flags: "",
      category: "SNILS",
      validate: snils,
    },
  ],
  [
    "inn",
    [
      // 12-digit INN is precise on its own (two check digits), no context needed.
      {
        pattern: String.raw`(?<!\d)\d{12}(?!\d)`,
        flags: "",
        category: "INN",
        validate: inn12,
      },
      // 10-digit INN has a single check digit, so it requires a nearby label.
      {
        pattern: String.raw`(?<!\d)\d{10}(?!\d)`,
        flags: "",
        category: "INN",
        validate: inn10,
        context: INN_CONTEXT,
      },
    ],
  ],
  [
    "iban",
    {
      pattern: String.raw`(?<![A-Z0-9])[A-Z]{2}\d{2}[A-Z0-9]{11,30}(?![A-Z0-9])`,
      flags: "",
      category: "IBAN",
      validate: mod97,
    },
  ],
  [
    "cpf",
    {
      pattern: String.raw`\d{3}\.\d{3}\.\d{3}-\d{2}`,
      flags: "",
      category: "CPF",
      validate: cpf,
    },
  ],
  [
    "cnpj",
    {
      pattern: String.raw`\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}`,
      flags: "",
      category: "CNPJ",
      validate: cnpj,
    },
  ],
  [
    "ogrn",
    {
      pattern: String.raw`(?<!\d)\d{13}(?!\d)`,
      flags: "",
      category: "OGRN",
      validate: ogrn13,
      context: OGRN_CONTEXT,
    },
  ],
  [
    "ogrnip",
    {
      pattern: String.raw`(?<!\d)\d{15}(?!\d)`,
      flags: "",
      category: "OGRNIP",
      validate: ogrnip15,
      context: OGRNIP_CONTEXT,
    },
  ],
  [
    "pesel",
    {
      pattern: String.raw`(?<!\d)\d{11}(?!\d)`,
      flags: "",
      category: "PESEL",
      validate: pesel,
      context: PESEL_CONTEXT,
    },
  ],
  [
    "aadhaar",
    {
      pattern: String.raw`(?<!\d)\d{12}(?!\d)`,
      flags: "",
      category: "AADHAAR",
      validate: verhoeff,
      context: AADHAAR_CONTEXT,
    },
  ],
  [
    "ssn",
    {
      pattern: String.raw`(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)`,
      flags: "",
      category: "SSN",
      validate: usSsn,
      context: SSN_CONTEXT,
    },
  ],
  [
    "kpp",
    {
      pattern: String.raw`(?<![A-Z0-9])\d{4}[A-Z0-9]{2}\d{3}(?![A-Z0-9])`,
      flags: "",
      category: "KPP",
      validate: kpp,
      context: KPP_CONTEXT,
    },
  ],
  [
    "passport_ru",
    {
      // Passport has no checksum and a very generic shape, so the label is the
      // only gate. Handles `2202 123456` and `22 02 123456`.
      pattern: String.raw`(?<!\d)\d{2}\s?\d{2}\s?\d{6}(?!\d)`,
      flags: "",
      category: "PASSPORT_RU",
      context: PASSPORT_CONTEXT,
    },
  ],
])

export function buildPatternSet(patterns) {
  const raw = patterns && typeof patterns === "object" ? patterns : {}

  const keywords = Array.isArray(raw.keywords) ? raw.keywords : []
  const regex = Array.isArray(raw.regex) ? raw.regex : []
  const builtin = Array.isArray(raw.builtin) ? raw.builtin : []
  const exclude = Array.isArray(raw.exclude) ? raw.exclude : []

  const keywordRules = keywords
    .map((x) => {
      if (!x || typeof x !== "object") return null
      const value = String(x.value ?? "").trim()
      if (!value) return null
      const category = sanitizeCategory(x.category)
      return { value, category }
    })
    .filter(Boolean)

  const regexRules = []

  for (const x of regex) {
    if (!x || typeof x !== "object") continue
    const pattern = String(x.pattern ?? "").trim()
    if (!pattern) continue
    const category = sanitizeCategory(x.category)
    const flags = typeof x.flags === "string" ? x.flags : ""
    const peeled = peelInlineFlags(pattern, flags)
    regexRules.push({ pattern: peeled.pattern, flags: peeled.flags, category })
  }

  for (const name of builtin) {
    const key = String(name ?? "").trim()
    if (!key) continue
    const def = BUILTIN.get(key)
    if (!def) continue
    const items = Array.isArray(def) ? def : [def]
    for (const rule of items) {
      const context = normalizeContext(rule.context)
      regexRules.push({
        pattern: rule.pattern,
        flags: rule.flags,
        category: rule.category,
        validate: typeof rule.validate === "function" ? rule.validate : undefined,
        context,
        // Context-gated rules win when two rules compete for the same span.
        priority: context ? 1 : 0,
      })
    }
  }

  const excludeSet = new Set(exclude.map((x) => String(x ?? "")))
  const contextWindow =
    Number.isFinite(raw.context_window) && Number(raw.context_window) >= 0 ? Number(raw.context_window) : 30

  return {
    keywords: keywordRules,
    regex: regexRules,
    exclude: excludeSet,
    contextWindow,
  }
}


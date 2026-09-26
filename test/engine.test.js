import { test } from "node:test"
import assert from "node:assert/strict"

import { buildPatternSet } from "../src/patterns.js"
import { redactText } from "../src/engine.js"
import { PlaceholderSession } from "../src/session.js"

function makeSession() {
  return new PlaceholderSession({ prefix: "__VG_", ttlMs: 0, maxMappings: 1000 })
}

function redact(text, patterns) {
  return redactText(text, patterns, makeSession()).text
}

const checksumPatterns = buildPatternSet({
  builtin: ["snils", "inn", "iban", "cpf", "cnpj"],
})

test("redacts only when the checksum is valid", () => {
  const out = redact("SNILS 112-233-445 95 is valid", checksumPatterns)
  assert.match(out, /__VG_SNILS_[a-f0-9]{12}__/)
  assert.doesNotMatch(out, /112-233-445 95/)
})

test("leaves numbers with an invalid checksum unchanged", () => {
  const out = redact("SNILS 112-233-445 94 is invalid", checksumPatterns)
  assert.equal(out, "SNILS 112-233-445 94 is invalid")
})

test("masks a 12-digit INN but not an arbitrary 12-digit number", () => {
  const out = redact("INN 500100732259", checksumPatterns)
  assert.match(out, /__VG_INN_[a-f0-9]{12}__/)

  const junk = redact("number 123456789012", checksumPatterns)
  assert.equal(junk, "number 123456789012")
})

test("masks an IBAN but not one with a broken checksum", () => {
  assert.match(redact("GB82WEST12345698765432", checksumPatterns), /__VG_IBAN_/)
  assert.equal(
    redact("GB82WEST12345698765433", checksumPatterns),
    "GB82WEST12345698765433",
  )
})

test("masks CPF/CNPJ only with a valid checksum", () => {
  assert.match(redact("111.444.777-35", checksumPatterns), /__VG_CPF_/)
  assert.equal(redact("111.444.777-36", checksumPatterns), "111.444.777-36")
  assert.match(redact("11.222.333/0001-81", checksumPatterns), /__VG_CNPJ_/)
  assert.equal(redact("11.222.333/0001-82", checksumPatterns), "11.222.333/0001-82")
})

test("exclude still works", () => {
  const patterns = buildPatternSet({
    builtin: ["ipv4"],
    exclude: ["127.0.0.1"],
  })
  assert.equal(redact("host 127.0.0.1", patterns), "host 127.0.0.1")
  assert.match(redact("host 10.20.30.40", patterns), /__VG_IPV4_[a-f0-9]{12}__/)
})

test("exclude matches a domain inside an email, case-insensitively", () => {
  const patterns = buildPatternSet({
    builtin: ["email"],
    exclude: ["example.com"],
  })
  const lower = "user" + "@" + "example.com"
  const upper = "user" + "@" + "EXAMPLE.COM"
  const other = "user" + "@" + "corp.org"
  assert.equal(redact(`mail ${lower}`, patterns), `mail ${lower}`)
  assert.equal(redact(`mail ${upper}`, patterns), `mail ${upper}`)
  assert.match(redact(`mail ${other}`, patterns), /^mail __VG_EMAIL_[a-f0-9]{12}__$/)
})

test("exclude respects alphanumeric dots and dashes boundaries", () => {
  const patterns = buildPatternSet({
    builtin: ["email", "ipv4"],
    exclude: ["example.com", "127.0.0.1"],
  })
  // Contains `example.com` but is preceded by a word char, so not excluded.
  const subdomainish = "user" + "@" + "myexample.com"
  assert.match(redact(subdomainish, patterns), /__VG_EMAIL_[a-f0-9]{12}__/)
  // Exact excluded literal is left untouched.
  const exact = "127" + ".0.0.1"
  assert.equal(redact(`host ${exact}`, patterns), `host ${exact}`)
  // Starts with `127.0.0.1` but is followed by a digit, so not excluded.
  const trailing = "127" + ".0.0.11"
  assert.match(redact(`host ${trailing}`, patterns), /__VG_IPV4_[a-f0-9]{12}__/)
})

const ipv4Patterns = buildPatternSet({
  builtin: ["ipv4"],
  exclude: ["127.0.0.1", "0.0.0.0"],
})

test("ipv4 ignores version numbers, overlong components and out-of-range octets", () => {
  // Fourth component is longer than three digits, so the trailing digits are not swallowed.
  const trailingDigits = 'Version="192.168.10.2424"'
  assert.equal(redact(trailingDigits, ipv4Patterns), trailingDigits)
  // Octet above 255.
  const outOfRange = "build 10.2026.9.26"
  assert.equal(redact(outOfRange, ipv4Patterns), outOfRange)
})

test("ipv4 is suppressed when the value is a version attribute", () => {
  const assembly = 'AssemblyVersion="10.20.30.40"'
  assert.equal(redact(assembly, ipv4Patterns), assembly)
  const fileVersion = 'FileVersion = "10.20.30.40"'
  assert.equal(redact(fileVersion, ipv4Patterns), fileVersion)
})

test("ipv4 still redacts real addresses without a version label", () => {
  assert.match(redact("addr 10.20.30.40 port 443", ipv4Patterns), /^addr __VG_IPV4_[a-f0-9]{12}__ port 443$/)
  assert.equal(redact("host 127.0.0.1", ipv4Patterns), "host 127.0.0.1")
})

test("builtin is disabled when not listed in the config", () => {
  const patterns = buildPatternSet({ builtin: [] })
  assert.equal(redact("GB82WEST12345698765432", patterns), "GB82WEST12345698765432")
})

const contextPatterns = buildPatternSet({
  builtin: ["inn", "ogrn", "aadhaar", "ssn", "kpp", "passport_ru"],
})

test("context-gated rule matches only with a nearby label", () => {
  assert.match(redact("INN 7707083893", contextPatterns), /__VG_INN_[a-f0-9]{12}__/)
  assert.equal(redact("number 7707083893", contextPatterns), "number 7707083893")
})

test("12-digit INN needs no context (two check digits)", () => {
  assert.match(redact("id 500100732259", contextPatterns), /__VG_INN_/)
})

test("label outside the context window does not trigger", () => {
  const far = `INN${" ".repeat(40)}7707083893`
  assert.equal(redact(far, contextPatterns), far)
})

test("context_window is configurable", () => {
  const far = `INN${" ".repeat(10)}7707083893`
  assert.match(redact(far, contextPatterns), /__VG_INN_/)
  assert.equal(redact(far, buildPatternSet({ builtin: ["inn"], context_window: 5 })), far)
})

test("latin labels respect word boundaries (do not match inside words)", () => {
  assert.equal(redact("beginning 7707083893", contextPatterns), "beginning 7707083893")
})

test("context-gated rule wins over a non-context rule on the same span", () => {
  const out = redact("Aadhaar 234123412346", contextPatterns)
  assert.match(out, /__VG_AADHAAR_[a-f0-9]{12}__/)
  assert.doesNotMatch(out, /__VG_INN_/)
})

test("SSN requires a label", () => {
  assert.match(redact("SSN 123-45-6789", contextPatterns), /__VG_SSN_/)
  assert.equal(redact("ref 123-45-6789", contextPatterns), "ref 123-45-6789")
})

test("KPP and Russian passport require labels", () => {
  assert.match(redact("KPP 770701001", contextPatterns), /__VG_KPP_/)
  assert.equal(redact("code 770701001", contextPatterns), "code 770701001")
  assert.match(redact("passport 2202 123456", contextPatterns), /__VG_PASSPORT_RU_/)
  assert.equal(redact("number 2202 123456", contextPatterns), "number 2202 123456")
})

const phonePatterns = buildPatternSet({ builtin: ["phone"] })

test("international phone is redacted without a label", () => {
  assert.match(redact("call +7 (999) 123-45-67", phonePatterns), /__VG_PHONE_[a-f0-9]{12}__/)
  assert.match(redact("call +86 138 0013 8000", phonePatterns), /__VG_PHONE_[a-f0-9]{12}__/)
})

test("national phone requires a nearby label", () => {
  assert.match(redact("tel. 8 900 123 45 67", phonePatterns), /__VG_PHONE_[a-f0-9]{12}__/)
  assert.equal(redact("code 900 123 45 67", phonePatterns), "code 900 123 45 67")
})

test("national phone is masked exactly once (no double match on prefixed numbers)", () => {
  const out = redact("tel 8 900 123 45 67", phonePatterns)
  assert.equal((out.match(/__VG_PHONE_/g) ?? []).length, 1)
})

test("china_phone builtin was removed (bare 11-digit mobile is no longer matched)", () => {
  const patterns = buildPatternSet({ builtin: ["china_phone", "phone"] })
  assert.equal(redact("id 13800138000", patterns), "id 13800138000")
})

test("raw 11-digit SNILS is redacted only with a nearby label", () => {
  const patterns = buildPatternSet({ builtin: ["snils"] })
  assert.match(redact('"snils": "12345678964"', patterns), /__VG_SNILS_[a-f0-9]{12}__/)
  assert.equal(redact('"x": "12345678964"', patterns), '"x": "12345678964"')
})

test("raw national phone is redacted with a camelCase label", () => {
  assert.match(redact('"mobilePhone": "89001234567"', phonePatterns), /__VG_PHONE_[a-f0-9]{12}__/)
  assert.equal(redact('"x": "89001234567"', phonePatterns), '"x": "89001234567"')
})

test("raw national rule does not split an international number", () => {
  const out = redact("call +79870610507", phonePatterns)
  assert.equal((out.match(/__VG_PHONE_/g) ?? []).length, 1)
  assert.match(out, /^call __VG_PHONE_[a-f0-9]{12}__$/)
})

test("10-digit national phone is redacted only with a nearby label", () => {
  assert.match(redact("tel 8924187722", phonePatterns), /^tel __VG_PHONE_[a-f0-9]{12}__$/)
  assert.equal(redact("id 8924187722", phonePatterns), "id 8924187722")
})

test("10-digit national phone matches a camelCase label", () => {
  assert.match(redact('"mobilePhone": "8924187722"', phonePatterns), /__VG_PHONE_[a-f0-9]{12}__/)
})

test("10-digit rule does not split an 11-digit prefixed number", () => {
  const out = redact("tel 89240000005", phonePatterns)
  assert.equal((out.match(/__VG_PHONE_/g) ?? []).length, 1)
  assert.match(out, /^tel __VG_PHONE_[a-f0-9]{12}__$/)
})

test("10-digit rule does not match inside a longer digit run", () => {
  const out = redact("tel 892418772234", phonePatterns)
  assert.equal(out, "tel 892418772234")
})

const credentialsPatterns = buildPatternSet({ builtin: ["credentials"] })

test("credentials redacts Authorization header tokens", () => {
  const basic = redact("Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==", credentialsPatterns)
  assert.match(basic, /^Authorization: Basic __VG_CREDENTIALS_[a-f0-9]{12}__$/)

  const bearer = redact("authorization: bearer eyJhbGciOiJIUzI1NiJ9.abc_123", credentialsPatterns)
  assert.match(bearer, /__VG_CREDENTIALS_[a-f0-9]{12}__/)
})

test("credentials ignores a bare scheme token without a header", () => {
  const bare = "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
  assert.equal(redact(bare, credentialsPatterns), bare)
})

test("credentials does not re-wrap an existing placeholder (idempotent)", () => {
  const session = makeSession()
  const real = "QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
  const once = redactText("Authorization: Basic " + real, credentialsPatterns, session).text
  assert.match(once, /^Authorization: Basic __VG_CREDENTIALS_[a-f0-9]{12}__$/)

  const twice = redactText(once, credentialsPatterns, session).text
  assert.equal(twice, once)
})

test("credentials leaves a placeholder after the header untouched", () => {
  const placeholder = "__VG_CREDENTIALS_0123456789ab__"
  assert.equal(
    redact("Authorization: Basic " + placeholder, credentialsPatterns),
    "Authorization: Basic " + placeholder,
  )
})

const newPatterns = buildPatternSet({
  builtin: ["card", "imei", "ipv6", "bank_account", "oms", "foreign_passport", "driver_license"],
})

test("card is redacted by Luhn + IIN without a label", () => {
  assert.match(redact("pay 4111111111111111", newPatterns), /^pay __VG_CARD_[a-f0-9]{12}__$/)
  assert.match(redact("pay 5500 0000 0000 0004", newPatterns), /^pay __VG_CARD_[a-f0-9]{12}__$/)
})

test("card does not match a 15-digit IMEI", () => {
  const out = redact("device 490154203237518", newPatterns)
  assert.match(out, /__VG_IMEI_[a-f0-9]{12}__/)
  assert.doesNotMatch(out, /__VG_CARD_/)
})

test("ipv6 is redacted without a label, ipv4 is not affected", () => {
  assert.match(redact("addr 2001:db8::1", newPatterns), /^addr __VG_IPV6_[a-f0-9]{12}__$/)
})

test("bank_account, oms, foreign and driver documents require labels", () => {
  assert.match(redact("account 40702810600000001234", newPatterns), /__VG_BANK_ACCOUNT_/)
  assert.equal(redact("ref 40702810600000001234", newPatterns), "ref 40702810600000001234")

  assert.match(redact("полис 1234567890123456", newPatterns), /__VG_OMS_/)
  assert.equal(redact("ref 1234567890123456", newPatterns), "ref 1234567890123456")

  assert.match(redact("загранпаспорт 51 1234567", newPatterns), /__VG_FOREIGN_PASSPORT_/)
  assert.match(redact("водительское 99 99 123456", newPatterns), /__VG_DRIVER_LICENSE_/)
})

const openaiPatterns = buildPatternSet({
  regex: [
    {
      pattern:
        "(?<![A-Za-z0-9_-])sk-(?:(?:proj|svcacct|service|admin)-[A-Za-z0-9_-]+|[A-Za-z0-9]+)T3BlbkFJ[A-Za-z0-9_-]+(?![A-Za-z0-9_-])",
      category: "OPENAI_KEY",
    },
    {
      pattern: "(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])",
      category: "OPENAI_KEY",
    },
  ],
})

test("openai regex masks real key formats in full (no leftover tail)", () => {
  const prefix = "s" + "k" + "-"
  const body = "Ab3dEf6hIj9lMn2pQr5s"
  const marker = "T3Bl" + "bkFJ"
  const legacy = prefix + body + marker + "tU8vWx1yZa4bCd6eFg"
  const project =
    prefix + "proj-" + body + "Tu8vWx1yZa4bCd6eFgHj0k" + marker + "l2mNo4pQr6sTu8vWx1yZa4bCd6eFgHj0k"
  const svcacct =
    prefix + "svcacct-" + body + "Tu8vWx1yZa4bCd6eFgHj0k" + marker + "l2mNo4pQr6sTu8vWx1yZa4bCd6eFg"
  const admin =
    prefix + "admin-" + body + "Tu8vWx1yZa4bCd6eFgHj0k" + marker + "l2mNo4pQr6sTu8vWx1yZa4bCd6eFg"
  for (const key of [legacy, project, svcacct, admin]) {
    assert.match(redact(key, openaiPatterns), /^__VG_OPENAI_KEY_[a-f0-9]{12}__$/)
  }
})

test("openai fallback masks a marker-less key in full", () => {
  const key = "sk-" + "A".repeat(51)
  assert.match(redact(key, openaiPatterns), /^__VG_OPENAI_KEY_[a-f0-9]{12}__$/)
})

test("openai regex ignores sk- as a word suffix and short values", () => {
  const untouched = [
    "task-management-system-v2",
    "risk-assessment-pipeline-service",
    "disk-usage-monitoring-service-x",
    "sk-shortvalue",
  ]
  for (const text of untouched) {
    assert.equal(redact(text, openaiPatterns), text)
  }
})

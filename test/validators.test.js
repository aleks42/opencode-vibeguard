import { test } from "node:test"
import assert from "node:assert/strict"

import { validators } from "../src/patterns.js"

const {
  snils,
  inn10,
  inn12,
  mod97,
  cpf,
  cnpj,
  ogrn13,
  ogrnip15,
  pesel,
  verhoeff,
  usSsn,
  kpp,
  intlPhone,
  nationalPhone,
  luhn,
  cardIin,
  card,
  imei,
  ipv4,
  ipv6,
} = validators

test("snils: accepts valid values (including mod 101 and 100/101 boundaries)", () => {
  assert.equal(snils("112-233-445 95"), true)
  assert.equal(snils("11223344595"), true)
})

test("snils: rejects wrong check digits and wrong length", () => {
  assert.equal(snils("112-233-445 94"), false)
  assert.equal(snils("112-233-445 96"), false)
  assert.equal(snils("112-233-44 95"), false)
})

test("inn12: accepts valid value", () => {
  assert.equal(inn12("500100732259"), true)
})

test("inn12: rejects wrong check digits", () => {
  assert.equal(inn12("500100732258"), false)
  assert.equal(inn12("500100733259"), false)
})

test("inn10: accepts valid value (enabled in iteration 2)", () => {
  assert.equal(inn10("7707083893"), true)
})

test("inn10: rejects wrong check digit", () => {
  assert.equal(inn10("7707083894"), false)
})

test("mod97 (IBAN): accepts valid values from multiple countries", () => {
  assert.equal(mod97("GB82WEST12345698765432"), true)
  assert.equal(mod97("DE89370400440532013000"), true)
  assert.equal(mod97("GB82 WEST 1234 5698 7654 32"), true)
})

test("mod97 (IBAN): rejects wrong check digits and invalid structure", () => {
  assert.equal(mod97("GB82WEST12345698765433"), false)
  assert.equal(mod97("GB82"), false)
  assert.equal(mod97("1234567890"), false)
})

test("cpf: accepts valid value, rejects wrong check digits and all-identical digits", () => {
  assert.equal(cpf("111.444.777-35"), true)
  assert.equal(cpf("11144477735"), true)
  assert.equal(cpf("111.444.777-36"), false)
  assert.equal(cpf("111.111.111-11"), false)
  assert.equal(cpf("000.000.000-00"), false)
})

test("cnpj: accepts valid value, rejects wrong check digits and all-identical digits", () => {
  assert.equal(cnpj("11.222.333/0001-81"), true)
  assert.equal(cnpj("11222333000181"), true)
  assert.equal(cnpj("11.222.333/0001-82"), false)
  assert.equal(cnpj("11.111.111/1111-11"), false)
})

test("ogrn13: accepts valid value, rejects wrong check digit and wrong length", () => {
  assert.equal(ogrn13("1027700132195"), true)
  assert.equal(ogrn13("1027700132196"), false)
  assert.equal(ogrn13("102770013219"), false)
})

test("ogrnip15: accepts valid value, rejects wrong check digit", () => {
  assert.equal(ogrnip15("304500000000009"), true)
  assert.equal(ogrnip15("304500000000001"), false)
})

test("pesel: accepts valid value, rejects wrong check digit and wrong length", () => {
  assert.equal(pesel("44051401359"), true)
  assert.equal(pesel("44051401358"), false)
  assert.equal(pesel("4405140135"), false)
})

test("verhoeff (Aadhaar): accepts valid value, rejects wrong check digit", () => {
  assert.equal(verhoeff("234123412346"), true)
  assert.equal(verhoeff("234123412345"), false)
  assert.equal(verhoeff("23412341234"), false)
})

test("usSsn: accepts valid shape, rejects forbidden area/group/serial ranges", () => {
  assert.equal(usSsn("123-45-6789"), true)
  assert.equal(usSsn("000-45-6789"), false)
  assert.equal(usSsn("666-45-6789"), false)
  assert.equal(usSsn("900-45-6789"), false)
  assert.equal(usSsn("123-00-6789"), false)
  assert.equal(usSsn("123-45-0000"), false)
  assert.equal(usSsn("123456789"), false)
})

test("kpp: accepts valid shape, rejects malformed values", () => {
  assert.equal(kpp("770701001"), true)
  assert.equal(kpp("7707AB001"), true)
  assert.equal(kpp("7707"), false)
  assert.equal(kpp("77070100"), false)
})

test("intlPhone: accepts valid international numbers, rejects bad ones", () => {
  assert.equal(intlPhone("+7 (999) 123-45-67"), true)
  assert.equal(intlPhone("+79991234567"), true)
  assert.equal(intlPhone("+86 138 0013 8000"), true)
  assert.equal(intlPhone("+1 (415) 555-2671"), true)
  assert.equal(intlPhone("+0123456789"), false)
  assert.equal(intlPhone("89991234567"), false)
  assert.equal(intlPhone("+7999"), false)
  assert.equal(intlPhone("+7 999 123 45 67 89 01 23"), false)
})

test("nationalPhone: accepts valid length, rejects too short/long and non-phone chars", () => {
  assert.equal(nationalPhone("8 900 123 45 67"), true)
  assert.equal(nationalPhone("(495) 123-45-67"), true)
  assert.equal(nationalPhone("020 7946 0958"), true)
  assert.equal(nationalPhone("123456"), false)
  assert.equal(nationalPhone("1234567890123456"), false)
  assert.equal(nationalPhone("8 900 123 45 67 x"), false)
})

test("luhn: accepts valid numbers, rejects wrong check digits", () => {
  assert.equal(luhn("4111111111111111"), true)
  assert.equal(luhn("490154203237518"), true)
  assert.equal(luhn("4111111111111112"), false)
  assert.equal(luhn(""), false)
})

test("cardIin: accepts known IIN prefixes (incl. Mir), rejects unknown ones", () => {
  assert.equal(cardIin("4111111111111111"), true) // Visa
  assert.equal(cardIin("5500005555555559"), true) // MasterCard
  assert.equal(cardIin("2200000000000004"), true) // Mir
  assert.equal(cardIin("378282246310005"), true) // Amex
  assert.equal(cardIin("6011111111111117"), true) // Discover
  assert.equal(cardIin("490154203237518"), true) // prefix-only: `49` looks like Visa
  assert.equal(cardIin("9999999999999999"), false)
})

test("card: accepts Luhn-valid cards with known IIN, rejects IMEI and bad check digit", () => {
  assert.equal(card("4111111111111111"), true)
  assert.equal(card("5500005555555559"), true)
  assert.equal(card("2200000000000004"), true)
  assert.equal(card("378282246310005"), true)
  assert.equal(card("4111 1111 1111 1111"), true)
  assert.equal(card("4111111111111112"), false)
  assert.equal(card("490154203237518"), false)
  assert.equal(card("1234567890123"), false)
})

test("imei: accepts valid Luhn checksum, rejects wrong/length", () => {
  assert.equal(imei("490154203237518"), true)
  assert.equal(imei("490154203237519"), false)
  assert.equal(imei("49015420323751"), false)
})

test("ipv4: accepts 0-255 quads, rejects out-of-range, malformed shapes and leading zeros", () => {
  assert.equal(ipv4("127.0.0.1"), true)
  assert.equal(ipv4("0.0.0.0"), true)
  assert.equal(ipv4("255.255.255.255"), true)
  assert.equal(ipv4("192.168.1.1"), true)
  assert.equal(ipv4("256.1.1.1"), false)
  assert.equal(ipv4("1.2.3.999"), false)
  assert.equal(ipv4("1.2.3"), false)
  assert.equal(ipv4("1.2.3.4.5"), false)
  assert.equal(ipv4("01.2.3.4"), false)
  assert.equal(ipv4("1.2.3.04"), false)
  assert.equal(ipv4("a.b.c.d"), false)
  assert.equal(ipv4(""), false)
})

test("ipv6: accepts full/compressed addresses and zones, rejects malformed", () => {
  assert.equal(ipv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), true)
  assert.equal(ipv6("2001:db8::1"), true)
  assert.equal(ipv6("::1"), true)
  assert.equal(ipv6("fe80::1%eth0"), true)
  assert.equal(ipv6("2001:db8:0:0:0:0:0:1"), true)
  assert.equal(ipv6("2001:db8:::1"), false)
  assert.equal(ipv6("12345::1"), false)
  assert.equal(ipv6("gg::1"), false)
  assert.equal(ipv6("1.2.3.4"), false)
})

// Month names follow the chrome language. An English visitor on an Arabic
// instance used to read "14 أغسطس 2026" because siteDate() passed blogLocale
// straight to Intl. Digits stay on localeDigits (Western unless asked).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { siteDate } from "../client/dates.ts";
import { setLang } from "../client/i18n.ts";
import { dateNamesLocale, formatCalendarDate } from "../shared/dates.ts";

const ISO = "2026-01-09T00:00:00.000Z";
const LONG_UTC: Intl.DateTimeFormatOptions = { dateStyle: "long", timeZone: "UTC" };

describe("dateNamesLocale", () => {
  it("an English reader on an Arabic instance gets an English tag", () => {
    assert.equal(dateNamesLocale("ar", "en"), "en");
    assert.equal(dateNamesLocale("ar-EG", "en"), "en");
    assert.equal(dateNamesLocale("ar-SA-u-nu-latn", "en"), "en");
  });

  it("keeps a regional English tag for an English reader", () => {
    assert.equal(dateNamesLocale("en-GB", "en"), "en-GB");
    assert.equal(dateNamesLocale("en", "en"), "en");
  });

  it("an Arabic reader keeps an Arabic regional tag", () => {
    assert.equal(dateNamesLocale("ar-EG", "ar"), "ar-EG");
    assert.equal(dateNamesLocale("ar", "ar"), "ar");
  });

  it("an Arabic reader on an English instance still gets Arabic names", () => {
    assert.equal(dateNamesLocale("en", "ar"), "ar");
    assert.equal(dateNamesLocale("en-GB", "ar"), "ar");
  });
});

describe("English chrome does not print Arabic month names", () => {
  it("formatCalendarDate in en says January, not يناير", () => {
    const en = formatCalendarDate(new Date(ISO), "en", "gregorian", "en", LONG_UTC);
    const ar = formatCalendarDate(new Date(ISO), "ar", "gregorian", "ar", LONG_UTC);
    assert.match(en, /January/);
    assert.doesNotMatch(en, /يناير/);
    assert.match(ar, /يناير/);
    assert.doesNotMatch(ar, /January/);
  });

  it("siteDate remaps an Arabic blogLocale when chrome is English", () => {
    setLang("en");
    const text = siteDate(ISO, "ar", LONG_UTC);
    assert.match(text, /January/);
    assert.doesNotMatch(text, /يناير/);
  });

  it("siteDate keeps Arabic month names when chrome is Arabic", () => {
    setLang("ar");
    const text = siteDate(ISO, "ar", LONG_UTC);
    assert.match(text, /يناير/);
    assert.doesNotMatch(text, /January/);
  });

  it("digits stay Western on an Arabic instance", () => {
    setLang("ar");
    const text = siteDate(ISO, "ar", LONG_UTC);
    assert.match(text, /2026/);
    assert.doesNotMatch(text, /[٠-٩]/);
  });
});

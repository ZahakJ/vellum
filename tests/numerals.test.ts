// One numeral policy, and the labels that sit beside the numbers.
//
// The regression this file exists for: a blog card that read
// "٩ يناير ٢٠٢٦ · 3 دقائق قراءة" — the date in Eastern Arabic digits, the
// count beside it in Western ones, on the same line. shared/numerals.ts is now
// the single source for BOTH, so the tests below always check a date and a
// count together.
//
// The second rule is subtler and has bitten once: the separator between those
// two fields must never be confusable with a DIGIT. A middot beside Arabic
// numerals reads as ٠ (Arabic-Indic zero), which turns "٣ · ٥" into "٣٠٥".

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { topicUrl } from "../client/blog/nav.ts";
import {
  autoDir,
  countPhrase,
  getNumerals,
  isolate,
  localeNum,
  setLang,
  setNumeralLocale,
  t,
  tf,
} from "../client/i18n.ts";
import { footerLine, initSite } from "../server/site.ts";
import { stripBidiControls } from "../shared/bidi.ts";
import { arabicDefaultDigits, localeDigits, numeralSystem, toNumerals } from "../shared/numerals.ts";
import { makeDir, removeVault } from "./helpers/vault.ts";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const MIDDOT = "·"; //   · — the meta-line separator
const ARABIC_THOUSANDS = "٬"; // ٬ — the grouping mark that belongs with ٠١٢
const ARABIC_ZERO = "٠"; // ٠

const data = makeDir();

after(() => removeVault(data));

// ---------------------------------------------------------------- the policy

describe("which digits a locale gets", () => {
  const CASES: [string, boolean][] = [
    ["ar", true],
    ["AR", true],
    ["ar-EG", true],
    ["ar-SA", true],
    ["arabic", false], // not a language subtag match
    ["ar-EG-u-nu-latn", false], // the admin named a system: honor it
    ["ar-u-nu-arab", false], // …even when it is the same one
    ["en", false],
    ["en-US", false],
    ["fa", false],
    ["", false],
  ];

  for (const [locale, arabic] of CASES) {
    it(`${locale || "(empty)"} → ${arabic ? "arab" : "latn"}`, () => {
      assert.equal(arabicDefaultDigits(locale), arabic);
      assert.equal(numeralSystem(locale), arabic ? "arab" : "latn");
      assert.deepEqual(localeDigits(locale), arabic ? { numberingSystem: "arab" } : {});
    });
  }
});

describe("toNumerals", () => {
  it("is the identity for latn", () => {
    assert.equal(toNumerals("1,234 · 5", "latn"), "1,234 · 5");
  });

  it("maps every ASCII digit and nothing else", () => {
    assert.equal(toNumerals("0123456789", "arab"), ARABIC_DIGITS);
    // Property: only "0" may ever become "٠". Anything else that turns into a
    // digit is the confusion bug this module was written to end.
    for (let code = 32; code < 127; code++) {
      const ch = String.fromCharCode(code);
      const out = toNumerals(ch, "arab");
      if (/[0-9]/.test(ch)) assert.equal(out, ARABIC_DIGITS[Number(ch)]);
      else assert.equal(out, ch, `${JSON.stringify(ch)} was rewritten`);
    }
  });

  it("leaves the meta-line separator alone", () => {
    assert.equal(toNumerals(`3 ${MIDDOT} 5`, "arab"), `٣ ${MIDDOT} ٥`);
  });
});

describe("a separator is never a digit", () => {
  it("the middot is not an Arabic-Indic digit", () => {
    assert.ok(!ARABIC_DIGITS.includes(MIDDOT));
    assert.notEqual(MIDDOT, ARABIC_ZERO);
    assert.notEqual(MIDDOT.charCodeAt(0), ARABIC_ZERO.charCodeAt(0));
  });

  it("grouping uses U+066C, not a middot and not a zero", () => {
    setNumeralLocale("ar");
    const n = localeNum(1234567);
    assert.equal(n, "١٬٢٣٤٬٥٦٧");
    assert.ok(n.includes(ARABIC_THOUSANDS));
    assert.ok(!n.includes(MIDDOT), "a middot inside a number reads as a zero");
    assert.ok(!n.includes(","), "an ASCII comma beside Arabic digits");
  });

  it("a formatted number contains ONLY digits and its grouping mark", () => {
    setNumeralLocale("ar");
    for (const n of [0, 7, 10, 99, 100, 1000, 12345, 1000000]) {
      const text = localeNum(n);
      assert.match(text, new RegExp(`^[${ARABIC_DIGITS}${ARABIC_THOUSANDS}]+$`), text);
      assert.ok(!/[0-9]/.test(text), `${text} still holds Western digits`);
    }
  });

  it("latn keeps ASCII digits and the ASCII comma", () => {
    setNumeralLocale("en");
    assert.equal(localeNum(1234567), "1,234,567");
    assert.equal(getNumerals(), "latn");
  });
});

describe("dates and the counts beside them agree", () => {
  const iso = "2026-01-09T00:00:00.000Z";
  const formatDate = (locale: string): string =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeZone: "UTC",
      ...localeDigits(locale),
    }).format(new Date(iso));

  it("an Arabic site prints Arabic digits in BOTH", () => {
    setLang("ar");
    setNumeralLocale("ar");
    const date = formatDate("ar");
    const count = countPhrase(3, "readMinutes");
    assert.ok(!/[0-9]/.test(date), `date fell back to Western digits: ${date}`);
    assert.ok(!/[0-9]/.test(count), `count fell back to Western digits: ${count}`);
    assert.match(date, new RegExp(`[${ARABIC_DIGITS}]`));
    assert.match(count, new RegExp(`[${ARABIC_DIGITS}]`));
    // The whole card line, separator included.
    const line = `${date} ${MIDDOT} ${count}`;
    assert.ok(!/[0-9]/.test(line), line);
  });

  it("an admin who asks for Western digits gets them in BOTH", () => {
    setLang("ar");
    setNumeralLocale("ar-EG-u-nu-latn");
    const date = formatDate("ar-EG-u-nu-latn");
    const count = countPhrase(3, "readMinutes");
    assert.match(date, /[0-9]/);
    assert.match(count, /[0-9]/);
    assert.ok(!new RegExp(`[${ARABIC_DIGITS}]`).test(count), count);
  });

  it("the footer year follows the same policy", () => {
    initSite({ VELLUM_DATA: data, SITE_LANG: "ar" });
    const year = String(new Date().getFullYear());
    assert.equal(footerLine(), `© ${toNumerals(year, "arab")} Vellum`);
    initSite({ VELLUM_DATA: data, SITE_LANG: "ar", SITE_FOOTER: "{siteName} — {year}", SITE_NAME: "دفتر" });
    assert.equal(footerLine(), `دفتر — ${toNumerals(year, "arab")}`);
    initSite({ VELLUM_DATA: data });
    assert.equal(footerLine(), `© ${year} Vellum`);
  });

  it("the CALENDAR stays Gregorian for every Arabic locale the validator takes", () => {
    // blogLocale accepts any BCP47 tag Intl canonicalizes, and a regional tag
    // can carry its own calendar (ar-SA historically resolved to
    // islamic-umalqura). If a future ICU brings that back, post dates would
    // render in Hijri while the footer year — a plain Gregorian number run
    // through toNumerals — kept saying ٢٠٢٦. This is the tripwire for that.
    for (const locale of ["ar", "ar-EG", "ar-SA", "ar-MA"]) {
      assert.equal(
        new Intl.DateTimeFormat(locale).resolvedOptions().calendar,
        "gregory",
        `${locale} resolved to a non-Gregorian calendar — dates and the footer year now disagree`,
      );
      assert.match(formatDate(locale), /٢٠٢٦|2026/);
    }
    // A tag that explicitly asks for Hijri is honored — it is a real choice.
    assert.equal(
      new Intl.DateTimeFormat("ar-SA-u-ca-islamic").resolvedOptions().calendar,
      "islamic",
    );
  });

  it("plain 'ar' would print WESTERN digits without localeDigits (why it exists)", () => {
    const bare = new Intl.DateTimeFormat("ar", { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(iso),
    );
    const pinned = formatDate("ar");
    assert.match(bare, /2026/, "this ICU build answers latn for bare 'ar'");
    assert.match(pinned, /٢٠٢٦/);
  });
});

describe("count agreement", () => {
  it("English pluralizes on 1", () => {
    setLang("en");
    setNumeralLocale("en");
    assert.equal(countPhrase(0, "notes"), "0 notes");
    assert.equal(countPhrase(1, "notes"), "1 note");
    assert.equal(countPhrase(2, "notes"), "2 notes");
    assert.equal(countPhrase(1214, "notes"), "1,214 notes");
  });

  it("Arabic uses the real forms (one / two / few / many)", () => {
    setLang("ar");
    setNumeralLocale("ar");
    assert.equal(countPhrase(0, "notes"), "لا ملاحظات");
    assert.equal(countPhrase(1, "notes"), "ملاحظة واحدة");
    assert.equal(countPhrase(2, "notes"), "ملاحظتان");
    assert.equal(countPhrase(3, "notes"), "٣ ملاحظات");
    assert.equal(countPhrase(10, "notes"), "١٠ ملاحظات");
    assert.equal(countPhrase(11, "notes"), "١١ ملاحظة");
    assert.equal(countPhrase(1214, "notes"), "١٬٢١٤ ملاحظة");
  });

  it("the dual and few forms never glue a number to a singular", () => {
    setLang("ar");
    setNumeralLocale("ar");
    assert.equal(countPhrase(2, "readMinutes"), "دقيقتا قراءة");
    assert.equal(countPhrase(5, "readMinutes"), "٥ دقائق قراءة");
  });
});

// ------------------------------------------------------------- tag labels

describe("tag labels", () => {
  it("a topic URL encodes every tag shape", () => {
    assert.equal(topicUrl("draft"), "/topic/draft");
    assert.equal(topicUrl("zettel/seed"), "/topic/zettel%2Fseed");
    assert.equal(topicUrl("a b"), "/topic/a%20b");
    assert.equal(topicUrl("مسودة"), `/topic/${encodeURIComponent("مسودة")}`);
    assert.equal(topicUrl("c#"), "/topic/c%23");
  });

  it("a tag spliced into a sentence is bidi-isolated", () => {
    setLang("en");
    const label = tf("searchTag", { tag: "مسودة" });
    assert.ok(!label.includes("{tag}"), "placeholder survived");
    assert.ok(label.includes(isolate("مسودة")), "the value was not isolated");
    assert.equal(t("searchTag"), "Search #{tag}");
  });

  it("the same label localizes", () => {
    setLang("ar");
    assert.match(tf("searchTag", { tag: "draft" }), /^البحث عن #/);
    setLang("en");
  });

  it("a tag carrying a bidi override is defanged before display", () => {
    const hostile = `draft‮gnp.exe`;
    assert.equal(stripBidiControls(hostile), "draftgnp.exe");
    // Direction MARKS are not controls and must survive.
    assert.equal(stripBidiControls("‏مسودة"), "‏مسودة");
  });

  it("a tag renders in ITS OWN direction, not the chrome's", () => {
    setLang("en");
    assert.equal(autoDir("مسودة"), "rtl");
    assert.equal(autoDir("draft"), "ltr");
    assert.equal(autoDir("2026"), "ltr", "no strong character → chrome language");
    setLang("ar");
    assert.equal(autoDir("2026"), "rtl");
    assert.equal(autoDir("draft"), "ltr");
    setLang("en");
  });
});

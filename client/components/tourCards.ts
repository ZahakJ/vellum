// THE DECK — fifteen folios, one feature each.
//
// WHY THE COPY LIVES HERE AND NOT IN client/i18n.ts. The DICT is entry-chunk
// code: every string in it is downloaded by every reader on first paint,
// including the anonymous visitor reading one article. Fifteen names and
// fifteen two-sentence blurbs in two languages measure ~9 kB raw — more than
// four times the whole entry budget's remaining headroom (check-bundle.mjs:
// 541.1 kB actual against 543 kB), spent so that a surface almost nobody has
// opened yet can describe itself.
//
// So the tour's copy TRAVELS IN THE DATA, exactly as the fifty-nine presets'
// names and blurbs do (`PresetText` in shared/presets.ts, and the same reason
// written out there): both languages are required, they are resolved through
// the same `getLang()` every other localized surface reads, and the pair is
// gated — `tests/tour.test.ts` is this table's `assertPreset()`, because
// `check-i18n` only walks the DICT and would not notice an empty `ar`.
//
// Only the DOOR's strings are in the DICT, and they have to be: the palette
// row, the empty state's line and the shortcut sheet's footer are all painted
// before this module exists.
//
// This file is DATA. No React, no store, no DOM — a card names its action with
// a string and Tour.tsx owns the fifteen functions, which is what lets the test
// import the table under bare node.

/** Copy that travels in the data. Both halves are required. */
export interface TourText {
  en: string;
  ar: string;
}

/** What a card's button DOES. Tour.tsx maps each of these to a real call; a
 *  card may not invent behaviour, so the union is the whole contract. */
export type TourAction =
  | "designer"
  | "themes"
  | "preview"
  | "collections"
  | "trackers"
  | "history"
  | "search"
  | "templates"
  | "palette"
  | "library"
  | "split"
  | "graph"
  | "sync"
  | "drawer"
  | "shortcuts";

/** A prerequisite the card must CHECK and, when it is off, SAY — one quiet
 *  line under the blurb. A tour that sells a feature the instance has switched
 *  off is a tour that lies once and is never trusted again. */
export type TourPrereq = "comments" | "repo";

export interface TourCard {
  /** Stable id: the React key, the glyph's name, and what the deck remembers
   *  in localStorage. Renaming a card is free; renumbering an id sends a
   *  returning reader to a different folio. */
  id: string;
  name: TourText;
  /** Two sentences that sell the moment. Not documentation — the docs are
   *  linked from the README and they are a different job. */
  blurb: TourText;
  action: TourAction;
  /** The button's verb, when "Show me" is not the honest one. */
  verb?: TourText;
  /** Hidden from a read-only session: a visitor cannot run it, and a button
   *  that cannot work is furniture that lies (DESIGN.md's rule for the
   *  tracker card's −/+ on the public site, one surface over). */
  admin?: boolean;
  needs?: TourPrereq;
}

/** The one line a card says when its prerequisite is off. */
export const TOUR_PREREQ: Record<TourPrereq, TourText> = {
  comments: {
    en: "Reader comments are off on this instance — one row in the publishing settings turns them on.",
    ar: "تعليقات القراء معطّلة في هذه النسخة — يفتحها صفٌّ واحد في إعدادات النشر.",
  },
  repo: {
    en: "This vault is not a git work tree yet, so there is no history to read — backup is what makes it.",
    ar: "هذا القبو ليس شجرة عمل git بعد، فلا تأريخ يُقرأ — النسخ الاحتياطي هو ما يصنعه.",
  },
};

/** The deck's own chrome. Same argument as the cards: it is only ever painted
 *  once this chunk has landed. */
export const TOUR_UI = {
  showMe: { en: "Show me", ar: "أرِني" },
  next: { en: "Next", ar: "التالي" },
  prev: { en: "Previous", ar: "السابق" },
  /** The deck's live region announces the card that just arrived. */
  cardOf: { en: "{name} — {n} of {total}", ar: "{name} — {n} من {total}" },
  position: { en: "{n} of {total}", ar: "{n} من {total}" },
  deck: { en: "The tour", ar: "الجولة" },
  goTo: { en: "Go to {name}", ar: "الانتقال إلى {name}" },
  /** Under the buttons: how to flip, and that leaving is free. TWO of them,
   *  and CSS picks — a keyboard legend on a device with no keyboard is a
   *  taunt, which is the lesson the empty state learned one surface over. */
  hint: {
    en: "← → to flip · Esc to leave, and the tour remembers where you were",
    ar: "← → للتقليب · Esc للخروج، والجولة تتذكر أين كنت",
  },
  hintTouch: {
    en: "Swipe to flip · tap outside to leave, and the tour remembers where you were",
    ar: "اسحب للتقليب · انقر خارجها للخروج، والجولة تتذكر أين كنت",
  },
  /** The whole point, said once, on the last folio's back. */
  end: {
    en: "That is the tour. Everything in it also lives in the command palette — and now you know what to look for.",
    ar: "تلك هي الجولة. وكل ما فيها موجود في لوحة الأوامر أيضًا — وقد صرت تعرف الآن ما تبحث عنه.",
  },
} satisfies Record<string, TourText>;

/**
 * The folios, in the order a reader meets them.
 *
 * The ORDER is a curriculum, not an inventory: the designer opens because it
 * is the feature a real reader used the product for months without finding,
 * and that discovery failure is why this surface exists at all. What a reader
 * can DO with their writing comes before how the writing looks, and the two
 * cards about the machinery under it (backup, the phone) close.
 */
export const TOUR_CARDS: TourCard[] = [
  {
    id: "designer",
    name: { en: "The designer", ar: "المصمِّم" },
    blurb: {
      en: "Compose your public site from fifty-nine designed sections, dragged into the order you want, with the real page rebuilding beside you. Nothing reaches a reader until you press save.",
      ar: "ركّب موقعك العام من تسعة وخمسين قسمًا مصمَّمًا، تسحبها إلى الترتيب الذي تريد والصفحة الحقيقية تُبنى إلى جانبك. ولا يبلغ قارئًا شيءٌ قبل أن تضغط الحفظ.",
    },
    action: "designer",
    admin: true,
  },
  {
    id: "themes",
    name: { en: "Twenty-one rooms", ar: "إحدى وعشرون غرفة" },
    blurb: {
      en: "A theme here is a whole room — its own ground, type, accent and thirteen callout hues, each solved against the others, and some of them carry a slow ambient air behind the masthead. Walk them with the arrow keys and the app changes around you as you go.",
      ar: "السمة ها هنا غرفة كاملة: أرضيتها وخطها ولونها المميز وثلاثة عشر لونًا للتنبيهات، كلٌّ محلولٌ في مواجهة الآخر، وبعضها يحمل أجواءً بطيئة خلف ترويسة الموقع. امشِ بينها بمفاتيح الأسهم يتبدّل التطبيق حولك وأنت تمشي.",
    },
    action: "themes",
  },
  {
    id: "publish",
    name: { en: "Publish, then look", ar: "انشُر ثم انظُر" },
    blurb: {
      en: "One line of frontmatter puts a note on the public web, and nothing else moves. Then step into a visitor's shoes and read your own site exactly as a stranger reads it.",
      ar: "سطر واحد في الترويسة يضع الملاحظة على الويب المفتوح، ولا يتحرك سواه. ثم تلبس ثوب الزائر فتقرأ موقعك كما يقرؤه الغريب تمامًا.",
    },
    action: "preview",
    verb: { en: "Look as a visitor", ar: "انظر كزائر" },
    admin: true,
    needs: "comments",
  },
  {
    id: "collections",
    name: { en: "Collections", ar: "المجموعات" },
    blurb: {
      en: "Hand your readers a shelf of your own making — up to twelve of them, each at its own address, each with its own mark. They sit beside the topics your notes already tag themselves with.",
      ar: "امنح قراءك رفًّا من صنعك — حتى اثني عشر رفًّا، لكلٍّ عنوانه الشبكي وعلامته. تقف إلى جانب المواضيع التي تسمّي بها ملاحظاتك نفسها.",
    },
    action: "collections",
    admin: true,
  },
  {
    id: "trackers",
    name: { en: "Trackers", ar: "المتتبِّعات" },
    blurb: {
      en: "A fenced block turns any note into a living progress card — a book, a game, a course — with a bar you can nudge one unit at a time. A second fence shelves every tracker in the vault.",
      ar: "كتلة مسيَّجة تحوّل أي ملاحظة إلى بطاقة تقدُّمٍ حيّة — كتابًا أو لعبة أو دورة — بشريطٍ تدفعه وحدةً وحدة. وكتلة ثانية ترصّ كل متتبِّعات القبو على رفٍّ واحد.",
    },
    action: "trackers",
    verb: { en: "Make me one", ar: "اصنع لي واحدة" },
    admin: true,
  },
  {
    id: "history",
    name: { en: "Every version you kept", ar: "كل نسخةٍ حفِظتَها" },
    blurb: {
      en: "The outline pane lists every commit that ever touched the note you are in. Read any revision exactly as it was, and restore one with an undo standing behind it.",
      ar: "يسرد جزء المخطط كل إيداعٍ مسّ الملاحظة التي أنت فيها. تقرأ أي مراجعة كما كانت بحذافيرها، وتستعيد واحدة والتراجع واقفٌ خلفك.",
    },
    action: "history",
    admin: true,
    needs: "repo",
  },
  {
    id: "search",
    name: { en: "Search that takes orders", ar: "بحثٌ يتلقّى الأوامر" },
    blurb: {
      en: "Ask for tag:, path:, is:published, before: or linkto:, and put a minus in front of any of them to mean “not”. Diacritics fold on both sides, so «المقدمة» finds «الْمُقَدِّمَة» and resume finds résumé.",
      ar: "اطلب ‎tag:‎ أو ‎path:‎ أو ‎is:published‎ أو ‎before:‎ أو ‎linkto:‎، وضع سالبًا أمام أيٍّ منها بمعنى «ليس». وتُطرح التشكيلات من الطرفين، فتجد «المقدمة» «الْمُقَدِّمَة» ويجد resume كلمة résumé.",
    },
    action: "search",
    verb: { en: "Run one", ar: "نفّذ بحثًا" },
  },
  {
    id: "templates",
    name: { en: "Templates", ar: "القوالب" },
    blurb: {
      en: "Obsidian's own template syntax, so a daily page or a meeting note starts already written, with the date and the title filled in. Insert one into what is open, or begin a new note from one.",
      ar: "صياغة القوالب نفسها التي في أوبسيديان، فتبدأ صفحة اليوم أو محضر الاجتماع مكتوبةً سلفًا، والتاريخ والعنوان مملوءان. أدرِج قالبًا فيما هو مفتوح، أو ابدأ ملاحظة جديدة منه.",
    },
    action: "templates",
    admin: true,
  },
  {
    id: "tex",
    name: { en: "LaTeX notes", ar: "ملاحظات لاتخ" },
    blurb: {
      en: "A .tex file is a note like any other here: edited, linked, searched, backlinked and published — and it still compiles on your own machine. The macro package that keeps that promise is one row away.",
      ar: "ملف ‎.tex‎ ملاحظةٌ كسائر الملاحظات هنا: يُحرَّر ويُربط ويُبحث فيه وتُجمع إحالاته ويُنشر — ولا يزال يُصرَّف على جهازك. وحزمة الماكرو التي تحفظ هذا الوعد على بعد صفٍّ واحد.",
    },
    action: "palette",
    verb: { en: "Open the palette", ar: "افتح لوحة الأوامر" },
  },
  {
    id: "books",
    name: { en: "A library in the vault", ar: "مكتبةٌ داخل القبو" },
    blurb: {
      en: "Drop a PDF into the vault and it becomes a book: read it in a tab beside your notes, mark it up, and cite a page with a wikilink that lands on the very rectangle you highlighted.",
      ar: "ألقِ ملف PDF في القبو فيصير كتابًا: تقرؤه في لسانٍ بجوار ملاحظاتك، وتعلّم عليه، وتستشهد بصفحةٍ برابط ويكي يهبط على المستطيل الذي ظلّلته بعينه.",
    },
    action: "library",
  },
  {
    id: "panes",
    name: { en: "Two notes at once", ar: "ملاحظتان في آنٍ واحد" },
    blurb: {
      en: "Split the pane beside or below and keep reading one note while you write the other. Every pane carries its own tabs, and the whole arrangement comes back the way you left it.",
      ar: "اشطر الجزء إلى جانبه أو أسفله، فتظل تقرأ في ملاحظةٍ بينما تكتب الأخرى. ولكل جزءٍ ألسنته، وتعود القسمة كلها كما تركتها.",
    },
    action: "split",
    verb: { en: "Split this pane", ar: "اشطر هذا الجزء" },
    admin: true,
  },
  {
    id: "graph",
    name: { en: "The vault as a constellation", ar: "القبو كوكبةً" },
    blurb: {
      en: "Every note is a disc and every link a thread, settled by a force simulation that runs entirely on your own machine. Rest the pointer on a note and its whole neighbourhood lights up.",
      ar: "كل ملاحظةٍ قرصٌ وكل رابطٍ خيط، تستقر بمحاكاة قوًى تجري على جهازك وحده لا غير. أرِح المؤشر على ملاحظة فيضيء جوارها كله.",
    },
    action: "graph",
  },
  {
    id: "sync",
    name: { en: "A vault that backs itself up", ar: "قبوٌ ينسخ نفسه" },
    blurb: {
      en: "Commit the whole vault to a private git remote that you own, by hand or on a timer, fast-forward only so nothing is ever overwritten. Nothing leaves this machine that you did not point it at.",
      ar: "أودِع القبو كله في مستودع git خاصٍّ تملكه أنت، بيدك أو على مؤقِّت، تقديمًا سريعًا لا غير فلا يُطمس شيء أبدًا. ولا يغادر هذا الجهاز شيءٌ لم توجّهه إليه بنفسك.",
    },
    action: "sync",
    admin: true,
  },
  {
    id: "phone",
    name: { en: "It works with a thumb", ar: "يعمل بإبهامٍ واحد" },
    blurb: {
      en: "Drag the page sideways and the notes pane follows your finger, reversible mid-gesture, the way every phone app you already use behaves. There is an Android build too, with a share sheet that drops anything into today's inbox note.",
      ar: "اسحب الصفحة جانبًا فيتبع جزءُ الملاحظات إصبعك، ويرتدّ في منتصف الحركة إن شئت، كما تفعل كل تطبيقات الهاتف التي تعرفها. وثمّة بناءٌ لأندرويد أيضًا، بورقة مشاركة تُلقي أي شيء في ملاحظة وارد اليوم.",
    },
    action: "drawer",
    verb: { en: "Open the notes pane", ar: "افتح جزء الملاحظات" },
  },
  {
    id: "keys",
    name: { en: "Every keystroke, listed", ar: "كل ضغطة مفتاحٍ مسرودة" },
    blurb: {
      en: "One searchable sheet holds every binding the shell has, including the ones with no key at all — those name the surface that carries them instead. On an Arabic keyboard it prints what the key actually types.",
      ar: "ورقة واحدة قابلة للبحث تضم كل ارتباطات المفاتيح في الواجهة، حتى ما لا مفتاح له — فتلك تسمّي السطح الذي يحملها بدلًا منه. وعلى لوحة مفاتيح عربية تطبع ما يكتبه المفتاح فعلًا.",
    },
    action: "shortcuts",
    verb: { en: "Open the sheet", ar: "افتح الورقة" },
  },
];

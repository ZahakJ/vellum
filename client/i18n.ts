// Tiny chrome-string localizer. The app chrome speaks the instance language
// (settings.language / SITE_LANG env, via /api/me): every user-facing chrome
// string funnels through t()/tf() below. Note CONTENT is never translated —
// it renders as authored (per-block dir=auto handles mixed scripts).
//
// Components that render t() strings should subscribe to the store's
// `language` field so a live settings change re-renders them; state.ts calls
// setLang() before it commits the new language to the store.

import { numeralSystem, toNumerals, type NumeralSystem } from "../shared/numerals.ts";

export type Lang = "en" | "ar";

let current: Lang = "en";
let numerals: NumeralSystem = "latn";

/** Set the active chrome language (state.ts owns the call). */
export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Set the instance's date locale — it decides the numerals EVERY number in
 *  the chrome is rendered in, not just the dates (state.ts owns the call). */
export function setNumeralLocale(locale: string): void {
  numerals = numeralSystem(locale);
}

/** The active numbering system (chrome counts + dates agree by construction). */
export function getNumerals(): NumeralSystem {
  return numerals;
}

/** A bare number in the instance's numeral system ("3" / "٣"), grouped in
 *  thousands ("1,214" / "١٬٢١٤"). Grouping is not decoration: every caller is
 *  a COUNT, and the one that matters most sits in a dialog whose whole job is
 *  conveying magnitude before a subtree is erased — "1214" reads as a token,
 *  "1,214" reads as a number. The Arabic separator is U+066C, the one that
 *  belongs with Eastern Arabic digits. */
export function localeNum(n: number): string {
  const grouped = new Intl.NumberFormat("en-US").format(n);
  return numerals === "arab" ? toNumerals(grouped, numerals).replaceAll(",", "٬") : grouped;
}

interface Entry {
  en: string;
  ar: string;
}

const DICT = {
  // ── Sidebar ──────────────────────────────────────────────────────────────
  searchPlaceholder: { en: "Search notes…", ar: "بحث في الملاحظات…" },
  searchTitle: { en: "Search notes (Ctrl/Cmd+K)", ar: "بحث في الملاحظات (Ctrl/Cmd+K)" },
  noMatchesDot: { en: "No matches.", ar: "لا نتائج مطابقة." },
  tags: { en: "Tags", ar: "وسوم" },
  showTags: { en: "Show tags", ar: "إظهار الوسوم" },
  hideTags: { en: "Hide tags", ar: "إخفاء الوسوم" },
  searchTag: { en: "Search #{tag}", ar: "البحث عن #{tag}" },
  clearTagFilter: { en: "Clear #{tag} filter", ar: "مسح تصفية #{tag}" },
  newNote: { en: "New note", ar: "ملاحظة جديدة" },
  newFolder: { en: "New folder", ar: "مجلد جديد" },
  newNoteHere: { en: "New note here", ar: "ملاحظة جديدة هنا" },
  rename: { en: "Rename", ar: "إعادة تسمية" },
  delete: { en: "Delete", ar: "حذف" },
  // A note deletes at the same two speeds as a folder — the first dialog
  // promises .trash, the second is the erase — so these read as the folder's
  // pair does, one line apart in the same menu.
  deleteNoteTitle: { en: "Move “{name}” to .trash?", ar: "نقل “{name}” إلى ‎.trash‎؟" },
  deleteNoteBody: {
    en: "“{path}” will move to the vault’s .trash folder — recoverable from disk.",
    ar: "سيُنقل “{path}” إلى مجلد ‎.trash‎ داخل الخزانة — يمكن استرجاعه من القرص.",
  },
  deleteNotePermTitle: { en: "Permanently delete “{name}”?", ar: "حذف “{name}” نهائيًا؟" },
  deleteNotePermBody: {
    en: "“{path}” will be erased from disk. This cannot be undone.",
    ar: "سيُمحى “{path}” من القرص. لا يمكن التراجع عن هذا.",
  },
  noteTrashedToast: {
    en: "Moved “{name}” to .trash — recover it from the vault folder",
    ar: "نُقلت “{name}” إلى ‎.trash‎ — يمكن استرجاعها من مجلد الخزانة",
  },
  noteDeletedToast: { en: "Deleted “{name}” permanently", ar: "حُذفت “{name}” نهائيًا" },
  creatingFolderFailed: { en: "Creating folder failed", ar: "فشل إنشاء المجلد" },
  deleteFolder: { en: "Delete folder", ar: "حذف المجلد" },
  // Folder deletion is a MOVE by default (the vault's .trash/), so the first
  // dialog promises recovery and the permanent erase is a second, quieter
  // step with its own confirmation.
  deleteFolderTitle: { en: "Move “{name}” to .trash?", ar: "نقل “{name}” إلى ‎.trash‎؟" },
  deleteFolderBody: {
    en: "{count} will move to the vault’s .trash folder — recoverable from disk.",
    ar: "ستُنقل {count} إلى مجلد ‎.trash‎ داخل الخزانة — يمكن استرجاعها من القرص.",
  },
  moveToTrash: { en: "Move to .trash", ar: "نقل إلى ‎.trash‎" },
  deletePermanently: { en: "Delete permanently", ar: "حذف نهائي" },
  deleteFolderPermTitle: { en: "Permanently delete “{name}”?", ar: "حذف “{name}” نهائيًا؟" },
  deleteFolderPermBody: {
    en: "{count} will be erased from disk. This cannot be undone.",
    ar: "ستُمحى {count} من القرص. لا يمكن التراجع عن هذا.",
  },
  folderTrashedToast: {
    en: "Moved “{name}” to .trash — recover it from the vault folder",
    ar: "نُقل “{name}” إلى ‎.trash‎ — يمكن استرجاعه من مجلد الخزانة",
  },
  folderDeletedToast: { en: "Deleted “{name}” permanently", ar: "حُذف “{name}” نهائيًا" },
  // The wordmark ENTERS visitor preview — a mode that takes the editor away.
  // A tooltip reading "View public site" did not say that, and the click was
  // the commonest accidental way into a shell with no editing in it.
  viewPublicSite: {
    en: "Preview the public site as a visitor (Esc returns)",
    ar: "معاينة الموقع العام كزائر (Esc للعودة)",
  },
  publishedOnly: { en: "Published only", ar: "المنشور فقط" },
  showAll: { en: "Show all", ar: "عرض الكل" },
  published: { en: "Published", ar: "منشور" },
  notesByTopic: { en: "Notes by topic", ar: "الملاحظات حسب الموضوع" },
  publishedNotes: { en: "Published notes", ar: "الملاحظات المنشورة" },
  notes: { en: "Notes", ar: "ملاحظات" },
  nothingPublished: { en: "Nothing published yet.", ar: "لا شيء منشور بعد." },
  home: { en: "Home", ar: "الرئيسية" },
  collapseSection: { en: "Collapse {label}", ar: "طي {label}" },
  expandSection: { en: "Expand {label}", ar: "توسيع {label}" },

  // ── Attachments (tree rows, filter toggle, viewer) ──────────────────────
  showAttachments: { en: "Show attachments", ar: "إظهار المرفقات" },
  hideAttachments: { en: "Hide attachments", ar: "إخفاء المرفقات" },
  attachmentsHidden: { en: "{count} hidden", ar: "{count} مخفية" },
  showMoreRows: { en: "Show {count} more", ar: "عرض {count} إضافية" },
  attachmentViewer: { en: "Attachment viewer", ar: "عارض المرفقات" },
  closeViewer: { en: "Close (Esc)", ar: "إغلاق (Esc)" },
  previousFile: { en: "Previous file", ar: "الملف السابق" },
  nextFile: { en: "Next file", ar: "الملف التالي" },
  openInNewTab: { en: "Open in new tab", ar: "فتح في تبويب جديد" },
  downloadFile: { en: "Download", ar: "تنزيل" },
  fileLoadFailed: { en: "This file could not be loaded.", ar: "تعذّر تحميل هذا الملف." },
  noPreviewFor: { en: "No preview for this file type.", ar: "لا معاينة لهذا النوع من الملفات." },
  unitBytes: { en: "B", ar: "بايت" },
  unitKB: { en: "KB", ar: "ك.ب" },
  unitMB: { en: "MB", ar: "م.ب" },

  // ── Tabs ────────────────────────────────────────────────────────────────
  closeTab: { en: "Close {title}", ar: "إغلاق {title}" },
  unsaved: { en: "unsaved", ar: "غير محفوظ" },

  // ── Status bar ──────────────────────────────────────────────────────────
  noNoteOpen: { en: "No note open", ar: "لا توجد ملاحظة مفتوحة" },
  publish: { en: "Publish", ar: "نشر" },
  publishTitle: {
    en: "Publish this note for visitors (Ctrl/Cmd+Shift+P)",
    ar: "نشر هذه الملاحظة للزوار (Ctrl/Cmd+Shift+P)",
  },
  unpublishTitle: {
    en: "Unpublish this note (Ctrl/Cmd+Shift+P)",
    ar: "إلغاء نشر هذه الملاحظة (Ctrl/Cmd+Shift+P)",
  },
  filterToPublished: {
    en: "Filter the sidebar to published notes",
    ar: "قصر الشريط الجانبي على الملاحظات المنشورة",
  },
  showFullVault: {
    en: "Show the full vault in the sidebar",
    ar: "عرض الخزانة كاملة في الشريط الجانبي",
  },
  // "Settings", full stop. "Site settings" said SITE about a panel that also
  // holds this browser's own theme, the editor's behavior and the backup
  // credentials, and the product has exactly one settings screen — a qualifier
  // that distinguishes nothing is a longer word for the same thing. The Arabic
  // is the dictionary's own term for the noun, as in settingsSaved and
  // settingsSections — not a fresh coinage.
  siteSettings: { en: "Settings", ar: "الإعدادات" },
  siteSettingsTitle: {
    en: "Settings — identity, home page, behavior, typography, backup",
    ar: "الإعدادات — الهوية والرئيسية والسلوك والطباعة والنسخ الاحتياطي",
  },
  previewAsVisitor: { en: "Preview as visitor", ar: "معاينة كزائر" },
  previewAsVisitorTitle: {
    en: "Preview as visitor — see exactly what the public site serves",
    ar: "معاينة كزائر — شاهد الموقع تمامًا كما يظهر للزوار",
  },
  // The button opens the PICKER (fifteen themes are browsed, not cycled), so
  // its tooltip names where you are and what the click does — not the one
  // theme a "next" step would have landed on.
  themeTitle: {
    // "all fifteen" was true until an instance could make a sixteenth: custom
    // themes are selectable everywhere a built-in is, so the tooltip counts
    // nothing it cannot count.
    en: "Theme: {theme} — click to browse them all",
    ar: "السمة: {theme} — انقر لتصفح جميع السمات",
  },

  // ── Theme picker ────────────────────────────────────────────────────────
  // Theme names USED to stay untranslated "because they are proper nouns".
  // Fifteen rooms were therefore identified by fifteen obscure pigment nouns —
  // verdigris, porphyry, iron-gall — which an Arabic reader met in Latin
  // script and an English one mostly could not decode either. The raw id is
  // still the value DEFAULT_THEME and the palette take (shared/themes.ts is
  // the one list, and it does not move); what changed is that the PICKER now
  // shows a human label and a one-line description of the room, in both
  // languages, with the id kept in the row's tooltip.
  thIronGall: { en: "Iron gall", ar: "حبر العفص" },
  thIronGallDesc: { en: "Gold leaf on candlelit ink", ar: "ذهب على حبر أسود دافئ" },
  thVoid: { en: "Void", ar: "الخلاء" },
  thVoidDesc: { en: "Cold cyan on true black", ar: "سماوي بارد على أسود خالص" },
  thLapis: { en: "Lapis", ar: "لازورد" },
  thLapisDesc: { en: "Bright gold on lapis blue-black", ar: "ذهب لامع على أزرق داكن" },
  thCinnabar: { en: "Cinnabar", ar: "زنجفر" },
  thCinnabarDesc: { en: "Vermilion on neutral graphite", ar: "قرمزي على رمادي محايد" },
  thBasalt: { en: "Basalt", ar: "بازلت" },
  thBasaltDesc: { en: "Pale sky on blue-grey stone", ar: "أزرق فاتح على حجر رمادي" },
  thVerdigris: { en: "Verdigris", ar: "زنجار" },
  thVerdigrisDesc: { en: "Oxidised copper on green-black", ar: "نحاس مؤكسد على أخضر داكن" },
  thPorphyry: { en: "Porphyry", ar: "سُمّاق" },
  thPorphyryDesc: { en: "Dusty rose on purple-black stone", ar: "وردي باهت على حجر بنفسجي" },
  thNocturne: { en: "Nocturne", ar: "ليليّة" },
  thNocturneDesc: { en: "Periwinkle on blue-black night", ar: "بنفسجي فاتح على زرقة الليل" },
  thTallow: { en: "Tallow", ar: "شحم الشموع" },
  thTallowDesc: { en: "Candle-flame amber on brown paper", ar: "كهرمان كلهب الشمعة على ورق بني" },
  thSumi: { en: "Sumi", ar: "سومي" },
  thSumiDesc: { en: "Indigo on ink-stick grey", ar: "نيلي على رمادي حبر الصين" },
  thMoss: { en: "Moss", ar: "طحلب" },
  thMossDesc: { en: "Lichen green on olive-black", ar: "أخضر أشن على زيتوني داكن" },
  thParchment: { en: "Parchment", ar: "رَقّ" },
  thParchmentDesc: { en: "Gold leaf on warm paper", ar: "ذهب على ورق دافئ" },
  thSandstone: { en: "Sandstone", ar: "حجر رملي" },
  thSandstoneDesc: { en: "Burnt orange on desert paper", ar: "برتقالي محروق على ورق صحراوي" },
  thLinen: { en: "Linen", ar: "كتان" },
  thLinenDesc: { en: "Ink blue on cool daylight", ar: "أزرق حبري على ضوء نهار بارد" },
  thSolar: { en: "Solar", ar: "شمسيّة" },
  thSolarDesc: { en: "Burnt gold on the brightest paper", ar: "ذهب محروق على أنصع ورق" },
  themeIdTitle: { en: "{name} — theme id “{id}”", ar: "{name} — معرّف السمة «{id}»" },
  themePicker: { en: "Theme", ar: "السمة" },
  themePickerHint: {
    en: "↑↓←→ preview · Enter keeps · Esc restores",
    ar: "↑↓←→ للمعاينة · Enter للتثبيت · Esc للاستعادة",
  },
  themeGroupDark: { en: "Dark", ar: "داكنة" },
  themeGroupLight: { en: "Light", ar: "فاتحة" },
  themeCurrent: { en: "current", ar: "الحالية" },
  // The row opens the picker; the ellipsis and the verb were both saying that
  // twice. "Themes" names the thing, which is what a command list is for —
  // and the Arabic is docTheming's own word (السمات).
  browseThemes: { en: "Themes", ar: "السمات" },
  graph: { en: "graph", ar: "مخطط" },
  graphTitle: { en: "Toggle graph view (Ctrl/Cmd+G)", ar: "تبديل عرض المخطط (Ctrl/Cmd+G)" },
  signIn: { en: "Sign in", ar: "تسجيل الدخول" },
  signInTitle: { en: "Sign in to edit this vault", ar: "تسجيل الدخول لتحرير هذه الخزانة" },
  signOut: { en: "Sign out", ar: "تسجيل الخروج" },
  signOutTitle: { en: "Sign out — back to the visitor view", ar: "تسجيل الخروج — العودة إلى واجهة الزائر" },

  // ── The two panes, named by WHAT THEY ARE ───────────────────────────────
  // Never by the edge they sit on. In Arabic the notes sidebar is on the
  // right and the outline panel on the left, so "the left bar" names a
  // different pane in each language — which is exactly how a reader came to
  // ask why "the left bar cannot be folded". Both tooltips carry their
  // keystroke, in both languages.
  paneNotes: { en: "Notes sidebar", ar: "لوحة الملاحظات" },
  paneOutline: { en: "Outline & backlinks", ar: "المحتويات والروابط الراجعة" },
  // The keystrokes moved: Ctrl/Cmd+B is BOLD in the editor now (every reader
  // arrives with that binding), so the two pane toggles took one more
  // modifier and kept their shape — same key, Shift picks the second pane.
  showPaneNotes: {
    en: "Show Notes sidebar (Ctrl/Cmd+Alt+B)",
    ar: "إظهار لوحة الملاحظات (Ctrl/Cmd+Alt+B)",
  },
  hidePaneNotes: {
    en: "Hide Notes sidebar (Ctrl/Cmd+Alt+B)",
    ar: "إخفاء لوحة الملاحظات (Ctrl/Cmd+Alt+B)",
  },
  showPaneOutline: {
    en: "Show Outline & backlinks (Ctrl/Cmd+Alt+Shift+B)",
    ar: "إظهار المحتويات والروابط الراجعة (Ctrl/Cmd+Alt+Shift+B)",
  },
  hidePaneOutline: {
    en: "Hide Outline & backlinks (Ctrl/Cmd+Alt+Shift+B)",
    ar: "إخفاء المحتويات والروابط الراجعة (Ctrl/Cmd+Alt+Shift+B)",
  },

  // ── Right panel ─────────────────────────────────────────────────────────
  backlinks: { en: "Backlinks", ar: "روابط راجعة" },
  noNoteOpenDot: { en: "No note open.", ar: "لا توجد ملاحظة مفتوحة." },
  noBacklinks: {
    en: "No backlinks yet — link to this note with [[…]]",
    ar: "لا روابط راجعة بعد — اربط بهذه الملاحظة عبر [[…]]",
  },
  outline: { en: "Outline", ar: "المحتويات" },
  localGraph: { en: "Local graph", ar: "مخطط محلي" },
  showLocalGraph: { en: "Show local graph", ar: "إظهار المخطط المحلي" },
  hideLocalGraph: { en: "Hide local graph", ar: "إخفاء المخطط المحلي" },
  noLinksYet: {
    en: "No links yet — link to or from this note with [[…]].",
    ar: "لا روابط بعد — اربط من هذه الملاحظة أو إليها عبر [[…]].",
  },
  noPublishedLinks: { en: "No published links yet.", ar: "لا روابط منشورة بعد." },

  // ── Command palette ─────────────────────────────────────────────────────
  palettePlaceholder: { en: "Type a command or search notes…", ar: "اكتب أمرًا أو ابحث في الملاحظات…" },
  paletteCommands: { en: "Commands", ar: "أوامر" },
  paletteOpenTabs: { en: "Open tabs", ar: "التبويبات المفتوحة" },
  paletteNotes: { en: "Notes", ar: "ملاحظات" },
  paletteNoMatches: { en: "No matches", ar: "لا نتائج" },
  cmdCreateHint: { en: "create", ar: "إنشاء" },
  cmdDailyNote: { en: "Open daily note", ar: "فتح ملاحظة اليوم" },
  cmdToggleGraph: { en: "Toggle graph", ar: "تبديل المخطط" },
  cmdViewHint: { en: "view", ar: "عرض" },
  cmdToggleReading: { en: "Toggle reading view", ar: "تبديل وضع القراءة" },
  // No longer a command label — the fifteen `Theme: <id>` palette rows are
  // gone — but still the blog's theme-button tooltip, which names the theme
  // in force.
  cmdTheme: { en: "Theme: {t}", ar: "السمة: {t}" },
  cmdAppearanceHint: { en: "appearance", ar: "المظهر" },
  cmdToggleVim: { en: "Toggle vim", ar: "تبديل vim" },
  cmdEditorHint: { en: "editor", ar: "المحرر" },
  // The side commands name a PHYSICAL edge, in both languages: an Arabic
  // reader moving the notes sidebar left is asking for the left of the
  // screen, not for "the trailing side". "Auto" is the third state and the
  // default — it follows the reading direction and keeps following it.
  cmdPaneSideAuto: {
    en: "Notes sidebar: follow the language",
    ar: "لوحة الملاحظات: تتبع لغة الواجهة",
  },
  cmdPaneSideLeft: {
    en: "Notes sidebar: pin to the left edge",
    ar: "لوحة الملاحظات: تثبيت على الحافة اليسرى",
  },
  cmdPaneSideRight: {
    en: "Notes sidebar: pin to the right edge",
    ar: "لوحة الملاحظات: تثبيت على الحافة اليمنى",
  },
  cmdLayoutHint: { en: "layout", ar: "التخطيط" },
  cmdLayoutCurrentHint: { en: "layout · in force", ar: "التخطيط · الحالي" },
  cmdTogglePaneNotes: { en: "Toggle Notes sidebar", ar: "طي لوحة الملاحظات" },
  cmdTogglePaneOutline: {
    en: "Toggle Outline & backlinks",
    ar: "طي المحتويات والروابط الراجعة",
  },
  cmdZen: { en: "Zen mode", ar: "وضع التركيز" },
  cmdZenHint: { en: "chrome steps aside", ar: "تنحسر الواجهة" },
  cmdPublishNote: { en: "Publish note", ar: "نشر الملاحظة" },
  cmdPublishHint: { en: "✦ live for visitors", ar: "✦ تصبح متاحة للزوار" },
  cmdUnpublishNote: { en: "Unpublish note", ar: "إلغاء نشر الملاحظة" },
  cmdUnpublishHint: { en: "✧ visitors lose it", ar: "✧ تختفي عن الزوار" },
  cmdSetBanner: { en: "Set banner…", ar: "تعيين الغلاف…" },
  cmdSetBannerHint: { en: "hero image", ar: "صورة الغلاف" },
  cmdRemoveBanner: { en: "Remove banner", ar: "إزالة الغلاف" },
  cmdRemoveBannerHint: { en: "clear the hero image", ar: "مسح صورة الغلاف" },
  cmdRenameCurrent: { en: "Rename current note", ar: "إعادة تسمية الملاحظة الحالية" },
  cmdMoveHint: { en: "move", ar: "نقل" },
  cmdDeleteCurrent: { en: "Delete current note", ar: "حذف الملاحظة الحالية" },
  // The palette's delete command runs the SAME two-speed flow the tree row
  // runs, and its default speed is the recoverable one. The hint names that
  // default — a hint promising "irreversible" one keystroke before a dialog
  // promising .trash is the two-guarantees-for-one-gesture defect again.
  cmdTrashHint: { en: "moves to .trash", ar: "ينقلها إلى ‎.trash‎" },
  cmdModerateComments: { en: "Moderate comments", ar: "الإشراف على التعليقات" },
  cmdMarginaliaHint: { en: "marginalia", ar: "الحواشي" },
  cmdSiteSettingsHint: {
    en: "identity · home · behavior · type · backup",
    ar: "الهوية · الرئيسية · السلوك · الطباعة · النسخ",
  },
  cmdPreviewHint: { en: "see the public site", ar: "شاهد الموقع العام" },
  cmdExitPreview: { en: "Exit visitor preview", ar: "إنهاء معاينة الزائر" },
  cmdExitPreviewHint: { en: "back to the vault", ar: "العودة إلى الخزانة" },
  cmdSignInHint: { en: "unlock editing", ar: "فتح التحرير" },
  cmdSignOutHint: { en: "back to reading", ar: "العودة إلى القراءة" },
  couldNotCreateNote: { en: "Could not create note", ar: "تعذر إنشاء الملاحظة" },
  couldNotRenameNote: { en: "Could not rename note", ar: "تعذرت إعادة تسمية الملاحظة" },
  couldNotDeleteNote: { en: "Could not delete note", ar: "تعذر حذف الملاحظة" },

  // ── Confirm / prompt / login modals ─────────────────────────────────────
  cancel: { en: "Cancel", ar: "إلغاء" },
  create: { en: "Create", ar: "إنشاء" },
  // The creation dialogs (client/prompts.ts). The destination line answers
  // "where does this land", and — because a path typed into the field nests
  // just as well as a name — teaches that in the same breath.
  promptInFolder: { en: "In {folder}", ar: "في {folder}" },
  promptAtRoot: {
    en: "At the vault root — type ideas/Name to nest it",
    ar: "في جذر المخزن — اكتب ideas/Name للتداخل داخل مجلد",
  },
  phFolderName: { en: "Folder name", ar: "اسم المجلد" },
  // What the typed text will actually become, shown BEFORE anything is
  // created: the ".md" and the folder used to be appended in silence.
  promptCreates: { en: "Creates {path}", ar: "سيُنشئ {path}" },
  promptNoTraversal: {
    en: "A path may not step outside the vault",
    ar: "لا يمكن للمسار الخروج من المخزن",
  },
  promptNoDotName: {
    en: "Names beginning with a dot are hidden from the vault",
    ar: "الأسماء التي تبدأ بنقطة مخفية عن المخزن",
  },
  signInTo: { en: "Sign in to {site}", ar: "تسجيل الدخول إلى {site}" },
  signInHint: { en: "Admin password unlocks editing.", ar: "كلمة مرور المشرف تفتح التحرير." },
  password: { en: "Password", ar: "كلمة المرور" },
  signingIn: { en: "Signing in…", ar: "جارٍ تسجيل الدخول…" },
  signInFailed: { en: "Sign-in failed", ar: "فشل تسجيل الدخول" },

  // ── Moderation panel ────────────────────────────────────────────────────
  moderationTitle: { en: "Marginalia — moderation", ar: "الحواشي — الإشراف" },
  newestSuffix: { en: " (newest)", ar: " (الأحدث)" },
  close: { en: "Close", ar: "إغلاق" },
  closeModeration: { en: "Close moderation panel", ar: "إغلاق لوحة الإشراف" },
  readingMargins: { en: "Reading the margins…", ar: "جارٍ قراءة الحواشي…" },
  commentsOff: {
    en: "Comments are switched off on this instance — start the server with COMMENTS=on to open the margins.",
    ar: "التعليقات معطلة على هذا الموقع — شغل الخادم مع COMMENTS=on لفتح الحواشي.",
  },
  commentsLoadFailed: {
    en: "Could not load comments — try again in a moment.",
    ar: "تعذر تحميل التعليقات — حاول مجددًا بعد قليل.",
  },
  marginsClean: {
    en: "The margins are clean — no comments anywhere yet.",
    ar: "الحواشي نظيفة — لا تعليقات في أي مكان بعد.",
  },
  hiddenChip: { en: "hidden", ar: "مخفي" },
  openNote: { en: "Open {path}", ar: "فتح {path}" },
  hideComment: { en: "Hide comment from visitors", ar: "إخفاء التعليق عن الزوار" },
  unhideComment: { en: "Unhide comment", ar: "إظهار التعليق" },
  deleteComment: { en: "Delete comment", ar: "حذف التعليق" },
  deleteCommentTitle: { en: "Delete comment?", ar: "حذف التعليق؟" },
  deleteCommentBody: {
    en: "The comment will be removed for everyone. This cannot be undone.",
    ar: "سيُحذف التعليق للجميع. لا يمكن التراجع عن هذا.",
  },
  hideCommentFailed: { en: "Hiding comment failed", ar: "فشل إخفاء التعليق" },
  unhideCommentFailed: { en: "Unhiding comment failed", ar: "فشل إظهار التعليق" },
  deleteCommentFailed: { en: "Deleting comment failed", ar: "فشل حذف التعليق" },

  // ── Banner modal / image pickers ────────────────────────────────────────
  bannerTitle: { en: "Banner", ar: "الغلاف" },
  bannerUrlPlaceholder: {
    en: "Paste an image URL (https://…) or a vault path",
    ar: "الصق رابط صورة (https://…) أو مسارًا داخل الخزانة",
  },
  use: { en: "Use", ar: "استخدام" },
  working: { en: "Working…", ar: "جارٍ العمل…" },
  dropImage: {
    en: "Drop an image here, or click to choose a file",
    ar: "أفلت صورة هنا، أو انقر لاختيار ملف",
  },
  dropHint: {
    en: "png · jpeg · webp · gif · svg — {max} MB max",
    ar: "بحد أقصى {max} ميغابايت — ‎png · jpeg · webp · gif · svg‎",
  },
  searchAttachments: { en: "Search vault attachments…", ar: "بحث في مرفقات الخزانة…" },
  loading: { en: "Loading…", ar: "جارٍ التحميل…" },
  noAttachments: { en: "No image attachments in the vault yet.", ar: "لا مرفقات صور في الخزانة بعد." },
  attachmentsFailed: {
    en: "Couldn't load the attachment list — check the server log.",
    ar: "تعذر تحميل قائمة المرفقات — راجع سجل الخادم.",
  },
  removeBanner: { en: "Remove banner", ar: "إزالة الغلاف" },
  uploadFailed: { en: "Upload failed", ar: "فشل الرفع" },

  // ── Settings panel ──────────────────────────────────────────────────────
  settingsNote: {
    en: "Empty fields inherit the server’s env defaults (shown greyed). Saved values win over env and apply live.",
    ar: "الحقول الفارغة ترث إعدادات الخادم الافتراضية (تظهر باهتة). القيم المحفوظة تتقدم عليها وتسري فورًا.",
  },
  groupHome: { en: "Home page", ar: "الصفحة الرئيسية" },
  // Named after the switch that turns these two rows on, in the panel's own
  // off-note idiom: they are read by the blog shell and by nothing else, and
  // an app-layout instance opens the home note at "/" instead.
  homeBlogOnlyNotice: {
    en: "Public layout is app: “/” opens the home note. Mode and the home banner are read by the blog layout only.",
    ar: "التخطيط العام «تطبيق»: تفتح «/» ملاحظة الرئيسية. الوضع وغلاف الرئيسية يقرأهما تخطيط المدونة وحده.",
  },
  homeNote: {
    en: "What “/” shows a visitor: an intro note, or a dashboard of the latest posts.",
    ar: "ما تعرضه «/» للزائر: ملاحظة تعريفية، أو لوحة بأحدث المقالات.",
  },

  // ── Settings tabs ────────────────────────────────────────────────────────
  // One name and one sentence each: a rail of seven category nouns tells a
  // reader where things are, never what they decide.
  tabIdentity: { en: "Site identity", ar: "هوية الموقع" },
  tabAppearance: { en: "Appearance & language", ar: "المظهر واللغة" },
  tabPublishing: { en: "Publishing & comments", ar: "النشر والتعليقات" },
  tabAbout: { en: "About", ar: "حول" },
  introIdentity: {
    en: "What the site is called and the marks it wears — name, tagline, footer, logo, favicon.",
    ar: "ما يُسمّى به الموقع والعلامات التي يحملها: الاسم وسطر التعريف والتذييل والشعار والأيقونة.",
  },
  introAppearance: {
    en: "What this instance looks and sounds like: the theme visitors arrive on (yours is separate and stays in this browser), the language the chrome speaks, and how dates and numbers are written.",
    ar: "كيف تبدو هذه النسخة وبأي لسان تتكلم: السمة التي يصل إليها الزوار (واختيارك أنت منفصل ويبقى في هذا المتصفح)، ولغة الواجهة، وطريقة كتابة التواريخ والأرقام.",
  },
  introPublishing: {
    en: "What visitors are allowed to see, what they can say back, and what the front door shows them first.",
    ar: "ما يُسمح للزوار برؤيته، وما يمكنهم قوله ردًّا، وما تعرضه عليهم الصفحة الأولى.",
  },
  introAbout: {
    en: "This instance: the version it runs, where it keeps things, and how much is in it.",
    ar: "هذه النسخة: الإصدار الذي تعمل به، وأين تحفظ ملفاتها، وكم فيها.",
  },

  // ── Appearance ───────────────────────────────────────────────────────────
  rowYourTheme: { en: "Your theme", ar: "سمتك" },
  hintYourTheme: { en: "your own pick — this browser only", ar: "اختيارك أنت — في هذا المتصفح فقط" },

  // ── The visitor language switch, said out loud ───────────────────────────
  visitorSwitchHead: { en: "Visitor language switch", ar: "مبدّل لغة الزائر" },
  visitorSwitchNote: {
    en: "Turning this on puts a small EN/ع switch in the public chrome. A reader who flips it changes the interface language and reading direction for themselves, and their choice is remembered in their own browser. Note text, dates and numerals never move: those stay in the site's own language and locale.",
    ar: "تفعيل هذا يضع مبدّل ‎EN/ع‎ صغيرًا في واجهة الموقع العامة. من يبدّله من القراء يغيّر لغة الواجهة واتجاه القراءة لنفسه، ويُحفظ اختياره في متصفحه هو. أما نص الملاحظات والتواريخ والأرقام فلا تتغير: تبقى على لغة الموقع وإعداداته المحلية.",
  },
  visitorSwitchOn: {
    en: "The switch is on: visitors see EN/ع in the public chrome.",
    ar: "المبدّل مفعل: يرى الزوار ‎EN/ع‎ في واجهة الموقع العامة.",
  },

  // ── About ────────────────────────────────────────────────────────────────
  aboutVersion: { en: "Version", ar: "الإصدار" },
  aboutRuntime: { en: "Runtime", ar: "بيئة التشغيل" },
  aboutVault: { en: "Vault", ar: "الخزانة" },
  aboutData: { en: "Instance data", ar: "بيانات النسخة" },
  // Where the panel's own answers are kept. This used to be a bare
  // "— settings.json" in the panel's TITLE, which named a file without saying
  // where it was and put an implementation detail in a heading.
  aboutSettingsFile: { en: "Settings file", ar: "ملف الإعدادات" },
  aboutFontsDir: { en: "Uploaded fonts", ar: "الخطوط المرفوعة" },
  aboutSettingsNote: {
    en: "Everything in this panel is stored in that one file. Delete it and the instance falls back to the environment defaults it was started with.",
    ar: "كل ما في هذه اللوحة يُحفظ في ذلك الملف وحده. إن حذفته عادت النسخة إلى الإعدادات البيئية التي بدأت بها.",
  },
  aboutContents: { en: "Contents", ar: "المحتويات" },
  aboutNotes: { en: "notes", ar: "ملاحظات" },
  aboutPublished: { en: "published", ar: "منشورة" },
  aboutAttachments: { en: "images", ar: "صور" },
  aboutTags: { en: "tags", ar: "وسوم" },
  aboutDocs: { en: "Documentation", ar: "التوثيق" },
  aboutDocsNote: {
    en: "Every setting in this panel is written up in the project README, in the section named beside it.",
    ar: "كل إعداد في هذه اللوحة موثّق في ملف ‎README‎ للمشروع، في القسم المذكور بجانبه.",
  },
  docSiteSettings: { en: "Settings", ar: "الإعدادات" },
  docTheming: { en: "Theming", ar: "السمات" },
  docTypography: { en: "Typography", ar: "الطباعة" },
  docArabic: { en: "Arabic & RTL", ar: "العربية والاتجاه" },
  docBlogMode: { en: "Blog mode", ar: "وضع المدونة" },
  docComments: { en: "Comments", ar: "التعليقات" },
  docSync: { en: "Backup & sync", ar: "النسخ الاحتياطي والمزامنة" },
  rowSiteName: { en: "Site name", ar: "اسم الموقع" },
  rowTagline: { en: "Tagline", ar: "سطر التعريف" },
  hintTagline: { en: "masthead subtitle", ar: "العنوان الفرعي في الترويسة" },
  rowFooter: { en: "Footer", ar: "التذييل" },
  hintFooter: { en: "{year} and {siteName} substituted", ar: "تستبدل {year} و{siteName}" },
  rowLogo: { en: "Logo", ar: "الشعار" },
  hintLogo: { en: "replaces the text wordmark", ar: "يحل محل اسم الموقع النصي" },
  rowFavicon: { en: "Favicon", ar: "أيقونة الموقع" },
  hintFavicon: { en: "served at /favicon.ico", ar: "تُقدَّم على المسار ‎/favicon.ico‎" },
  rowMode: { en: "Mode", ar: "الوضع" },
  hintMode: { en: "what visitors see at /", ar: "ما يراه الزوار في /" },
  rowHomeNote: { en: "Home note", ar: "ملاحظة الرئيسية" },
  hintHomeNote: { en: "intro note (note mode)", ar: "ملاحظة المقدمة (وضع «ملاحظة»)" },
  rowHomeBanner: { en: "Home banner", ar: "غلاف الرئيسية" },
  hintHomeBanner: { en: "hero image", ar: "صورة الواجهة" },
  rowDefaultTheme: { en: "Default theme", ar: "السمة الافتراضية" },
  hintDefaultTheme: { en: "visitors without a stored choice", ar: "للزوار بلا اختيار محفوظ" },
  rowPublicLayout: { en: "Public layout", ar: "التخطيط العام" },
  hintPublicLayout: { en: "visitor-facing shell", ar: "واجهة الزوار" },
  rowLanguage: { en: "Language", ar: "اللغة" },
  hintLanguage: { en: "site chrome language & direction", ar: "لغة واجهة الموقع واتجاهها" },
  // The notes sidebar's edge. The segment labels name a PHYSICAL edge in both
  // languages, exactly as the palette commands do — an Arabic reader pinning
  // the pane left means the left of the screen, not "the trailing side".
  rowSidebarSide: { en: "Notes sidebar", ar: "لوحة الملاحظات" },
  hintSidebarSide: {
    en: "which edge the tree sits on — Auto follows the language",
    ar: "الحافة التي تجلس عليها الشجرة — «تلقائي» يتبع اللغة",
  },
  sideAuto: { en: "Auto", ar: "تلقائي" },
  sideLeft: { en: "Left", ar: "يسار" },
  sideRight: { en: "Right", ar: "يمين" },
  rowLanguageFilter: { en: "Language filter", ar: "تصفية حسب اللغة" },
  hintLanguageFilter: {
    en: "public blog shows only notes in the site language",
    ar: "تعرض المدونة العامة ملاحظات بلغة الموقع فقط",
  },
  rowLanguageToggle: { en: "Visitor switch", ar: "مبدّل الزائر" },
  hintLanguageToggle: {
    en: "adds a public EN/ع switch readers can flip for themselves",
    ar: "يضيف مبدّل ‎EN/ع‎ عامًا يغيّره القارئ لنفسه",
  },
  rowDateLocale: { en: "Date locale", ar: "لغة التواريخ" },
  hintDateLocale: { en: "BCP47 — post dates, RSS", ar: "‏‎BCP47‎ — تواريخ المقالات و‎RSS‎" },
  rowExcludeTags: { en: "Excluded tags", ar: "وسوم مستبعدة" },
  hintExcludeTags: { en: "hidden from visitors, comma-separated", ar: "تخفى عن الزوار، مفصولة بفواصل" },
  rowComments: { en: "Comments", ar: "التعليقات" },
  hintComments: { en: "Marginalia under published notes", ar: "الحواشي أسفل الملاحظات المنشورة" },
  rowShareButtons: { en: "Share buttons", ar: "أزرار المشاركة" },
  hintShareButtons: { en: "Social share row under blog articles", ar: "صف المشاركة أسفل المقالات" },
  phVaultImageOrUrl: {
    en: "vault image path or https:// URL",
    ar: "مسار صورة في الخزانة أو رابط ‎https://‎",
  },
  phVaultIcon: {
    en: "vault image path (ico, png, svg…)",
    ar: "مسار صورة في الخزانة (‎ico, png, svg‎…)",
  },
  phExcludeTags: { en: "draft, todo…", ar: "مسودة، قيد الإنجاز…" },
  inheritOption: { en: "inherit ({value})", ar: "موروث ({value})" },
  // "inherit (en)" was honest about precedence and silent about its source:
  // the owner could read WHICH value was in force and never learn WHERE it
  // came from, or where to change it outside the panel.
  inheritedFromEnv: { en: "inherited from {env}", ar: "موروث من {env}" },
  on: { en: "on", ar: "مفعل" },
  off: { en: "off", ar: "معطل" },
  // Enum CHOICES a reader picks between, so they are copy — the same way the
  // booleans on the adjacent rows are. (Theme names stay untranslated one row
  // up: "iron-gall"/"lapis"/"parchment" are proper nouns, not common ones.)
  modeNote: { en: "note", ar: "ملاحظة" },
  modeDashboard: { en: "dashboard", ar: "لوحة" },
  layoutApp: { en: "app", ar: "تطبيق" },
  layoutBlog: { en: "blog", ar: "مدونة" },
  save: { en: "Save", ar: "حفظ" },
  saving: { en: "Saving…", ar: "جارٍ الحفظ…" },
  unsavedChanges: { en: "Unsaved changes", ar: "تغييرات غير محفوظة" },
  fixMarkedFields: { en: "Fix the marked fields", ar: "صحح الحقول المعلمة" },
  settingsSaved: { en: "Settings saved", ar: "تم حفظ الإعدادات" },
  settingsSaveFailed: { en: "Could not save settings", ar: "تعذر حفظ الإعدادات" },
  settingsLoadFailed: { en: "Could not load settings", ar: "تعذر تحميل الإعدادات" },
  pick: { en: "Pick…", ar: "اختيار…" },
  clear: { en: "Clear", ar: "مسح" },
  faviconImage: { en: "Favicon image", ar: "صورة الأيقونة" },
  logoImage: { en: "Logo image", ar: "صورة الشعار" },
  errMaxChars: { en: "{count} max", ar: "{count} كحد أقصى" },
  errLocale: { en: "not a valid BCP47 locale (en, ar-EG, de…)", ar: "ليست لغة ‎BCP47‎ صالحة (‎en, ar-EG, de‎…)" },
  errNotSimpleTag: { en: "“{tag}” is not a simple tag", ar: "“{tag}” ليس وسمًا بسيطًا" },
  // A note is `.md`, `.tex` or `.latex` now — the field validates all three,
  // so the message may not keep naming only one of them.
  errMdPath: {
    en: "must be a vault note path (.md, .tex, .latex)",
    ar: "يجب أن يكون مسار ملاحظة داخل الخزانة (‎.md‎ أو ‎.tex‎ أو ‎.latex‎)",
  },
  errMixedContent: {
    en: "http:// would be mixed content — use https:// or a vault path",
    ar: "‏‎http://‎ يسبب محتوى مختلطًا — استخدم ‎https://‎ أو مسارًا داخل الخزانة",
  },
  errVaultImage: { en: "must be a vault image path (ico, png, svg…)", ar: "يجب أن يكون مسار صورة داخل الخزانة (‎ico, png, svg‎…)" },
  errHttpsOrVault: { en: "must be an https:// URL or a vault image path", ar: "يجب أن يكون رابط ‎https://‎ أو مسار صورة داخل الخزانة" },
  errDotDot: { en: "path may not contain ..", ar: "لا يجوز أن يحتوي المسار على .." },
  errImageExt: {
    en: "must be an image (ico, png, svg, jpeg, gif, webp, avif)",
    ar: "يجب أن يكون صورة (‎ico, png, svg, jpeg, gif, webp, avif‎)",
  },

  // ── Preview banner ──────────────────────────────────────────────────────
  previewingPublicSite: { en: "Previewing public site", ar: "معاينة الموقع العام" },
  exitPreview: { en: "Exit preview", ar: "إنهاء المعاينة" },

  // ── App shell / empty states / toasts ───────────────────────────────────
  vaultPrivate: { en: "This vault is private.", ar: "هذه الخزانة خاصة." },
  vaultOpen: { en: "The vault is open.", ar: "الخزانة مفتوحة." },
  keyPalette: { en: "command palette", ar: "لوحة الأوامر" },
  keyGraph: { en: "graph view", ar: "عرض المخطط" },
  keySearch: { en: "search notes", ar: "بحث في الملاحظات" },
  keyNewNote: { en: "new note", ar: "ملاحظة جديدة" },
  keySave: { en: "save now", ar: "حفظ فوري" },
  keyReading: { en: "reading view", ar: "وضع القراءة" },
  // Lowercase like its six neighbours: the empty state sets these as a caption
  // row, and t("shortcutsTitle") arrived title-cased in the middle of them.
  keyShortcuts: { en: "keyboard shortcuts", ar: "اختصارات لوحة المفاتيح" },
  // The phone's half of the empty state. A keymap is not an answer on a device
  // with no keyboard, so below ~700px (and on any coarse pointer) the same
  // pane offers the notes this reader was last in, plus the three doors the
  // legend was only naming.
  emptyRecent: { en: "Recent notes", ar: "ملاحظات حديثة" },
  openSidebar: { en: "Open Notes sidebar", ar: "فتح لوحة الملاحظات" },
  closeSidebar: { en: "Close Notes sidebar", ar: "إغلاق لوحة الملاحظات" },
  exitZen: { en: "Exit zen mode (Esc)", ar: "إنهاء وضع التركيز (Esc)" },
  // The one keystroke zen advertises on screen — the ✕ beside it is the mouse
  // route, this is the one that works when the chrome has faded.
  zenEscHint: { en: "Esc", ar: "مفتاح Esc" },
  noteGone: { en: "That note does not exist (anymore)", ar: "هذه الملاحظة لم تعد موجودة" },
  changedOnDisk: {
    en: "{path} changed on disk — your unsaved edits were kept",
    ar: "تغيرت {path} على القرص — احتفظنا بتعديلاتك غير المحفوظة",
  },
  publishedToast: { en: "Published — live for visitors", ar: "نُشرت الملاحظة — أصبحت متاحة للزوار" },
  unpublishedToast: { en: "Unpublished", ar: "أُلغي النشر" },
  bannerSetToast: { en: "Banner set", ar: "تم تعيين الغلاف" },
  bannerRemovedToast: { en: "Banner removed", ar: "تمت إزالة الغلاف" },
  noDailyNote: {
    en: "No daily note for today — sign in to create it",
    ar: "لا توجد ملاحظة لليوم — سجل الدخول لإنشائها",
  },
  dailyNoteFailed: { en: "Could not create today's daily note", ar: "تعذر إنشاء ملاحظة اليوم" },
  saveFailed: { en: "Failed to save {path}", ar: "فشل حفظ {path}" },
  openFailed: { en: "Failed to open {path}", ar: "فشل فتح {path}" },
  // Not an error. Inside visitor preview the server 404s an unpublished note
  // because that is the CORRECT answer for a visitor, and the generic failure
  // string turned the owner's first use of the feature into a red alarm about
  // his own site. The calm wording says what happened and what to do.
  previewNotPublished: {
    en: "Not published — visitors cannot see this note",
    ar: "غير منشورة — لا يمكن للزوار رؤية هذه الملاحظة",
  },
  previewNotPublishedNamed: {
    en: "“{path}” is not published — visitors cannot see it, so it left the tab bar",
    ar: "«{path}» غير منشورة — لا يراها الزوار، لذلك غادرت شريط التبويبات",
  },

  // ── Wikilink clicks (editor + reading view) ─────────────────────────────
  linkNotPublished: { en: "“{name}” isn’t published here", ar: "“{name}” غير منشورة هنا" },
  linkMissing: { en: "“{name}” does not exist", ar: "“{name}” غير موجودة" },
  creatingNote: { en: "Creating “{name}”…", ar: "جارٍ إنشاء “{name}”…" },
  backToReference: { en: "Back to reference", ar: "العودة إلى الموضع" },

  // ── Graph view ──────────────────────────────────────────────────────────
  graphLoadFailed: { en: "Could not load graph", ar: "تعذر تحميل المخطط" },
  graphEmptyAdmin: {
    en: "No notes yet — create one and link it with wikilinks.",
    ar: "لا ملاحظات بعد — أنشئ واحدة واربطها بروابط ويكي.",
  },
  graphEmptyVisitor: {
    en: "Nothing is published yet — the constellation awaits.",
    ar: "لا شيء منشور بعد — الكوكبة تنتظر أن تتشكل.",
  },
  zoomIn: { en: "Zoom in", ar: "تكبير" },
  zoomOut: { en: "Zoom out", ar: "تصغير" },
  resetView: { en: "Reset view", ar: "إعادة ضبط العرض" },

  // ── Reading view ────────────────────────────────────────────────────────
  emptyNoteAdmin: {
    en: "This note is empty — press Ctrl+E to edit it.",
    ar: "هذه الملاحظة فارغة — اضغط Ctrl+E لتحريرها.",
  },
  emptyNoteVisitor: {
    en: "This page is intentionally blank.",
    ar: "هذه الصفحة فارغة عن قصد.",
  },

  // ── Editor chrome (properties card) ─────────────────────────────────────
  startWriting: { en: "Start writing…", ar: "ابدأ الكتابة…" },
  properties: { en: "Properties", ar: "الخصائص" },
  toggleProperties: { en: "Toggle properties", ar: "تبديل الخصائص" },
  bannerAction: { en: "Banner…", ar: "الغلاف…" },
  setBannerAction: { en: "Set banner…", ar: "تعيين الغلاف…" },
  setBannerTitle: { en: "Set a banner image for this note", ar: "تعيين صورة غلاف لهذه الملاحظة" },

  // ── Editor chrome built as raw DOM (folds, embeds, transclusions) ───────
  // These live in client/editor/*.ts and client/reading/render.ts — plain DOM
  // builders, not JSX — which is exactly why they were missed twice. The
  // check-i18n "bare English" scan now covers .ts DOM writes too.
  foldSection: { en: "Fold section", ar: "طي القسم" },
  unfoldSection: { en: "Unfold section", ar: "توسيع القسم" },
  missingImage: { en: "Missing image", ar: "صورة مفقودة" },
  uploadingImage: { en: "Uploading {name}…", ar: "جارٍ رفع {name}…" },
  embedNotCreated: {
    en: "Not created yet — click the link to create it.",
    ar: "لم تُنشأ بعد — انقر الرابط لإنشائها.",
  },
  noteLoadFailed: { en: "Could not load note.", ar: "تعذر تحميل الملاحظة." },
  noteEmpty: { en: "This note is empty.", ar: "هذه الملاحظة فارغة." },
  noteEmbedsItself: { en: "This note embeds itself.", ar: "هذه الملاحظة تُضمّن نفسها." },
  noNoteNamed: { en: "No note named “{name}”", ar: "لا توجد ملاحظة باسم “{name}”" },
  openNoteArrow: { en: "Open note ↗", ar: "فتح الملاحظة ↗" },
  docTitleGraph: { en: "Graph", ar: "المخطط" },

  // ── Editor slash menu ("/" at line start) ───────────────────────────────
  // Row titles only. The match key stays ASCII (see slashMenu.ts) and the
  // syntax previews ("- [ ]", "---") are markdown, not copy.
  slashCallout: { en: "Callout", ar: "تنبيه" },
  slashCodeBlock: { en: "Code block", ar: "كتلة شفرة" },
  slashCodeBlockDetail: { en: "``` with language search", ar: "``` مع بحث عن اللغة" },
  slashTable: { en: "Table", ar: "جدول" },
  slashTableDetail: { en: "3-column skeleton", ar: "هيكل من ثلاثة أعمدة" },
  slashTaskList: { en: "Task list", ar: "قائمة مهام" },
  slashMathBlock: { en: "Math block", ar: "كتلة معادلات" },
  slashMathDetail: { en: "$$ display math $$", ar: "$$ معادلة مستقلة $$" },
  slashDivider: { en: "Divider", ar: "فاصل" },
  slashDate: { en: "Date", ar: "تاريخ" },
  slashDailyLink: { en: "Daily note link", ar: "رابط ملاحظة اليوم" },

  // ── Blog shell: masthead, nav, footer ───────────────────────────────────
  blogTopics: { en: "Topics", ar: "المواضيع" },
  blogMore: { en: "More", ar: "المزيد" },
  blogPrivate: { en: "This journal is private.", ar: "هذه المدونة خاصة." },
  blogNoPage: { en: "There is no page here.", ar: "لا توجد صفحة هنا." },
  blogBackToWritings: { en: "Back to the writings", ar: "العودة إلى الكتابات" },
  blogSearchHint: { en: "search", ar: "بحث" },
  blogPoweredBy: { en: "powered by", ar: "مدعوم بـ" },
  blogSwitchTheme: { en: "Switch theme", ar: "تبديل السمة" },
  // The switch always targets the OTHER language, and this label renders in
  // the CURRENT one — so the two entries are each other's counterpart, not a
  // translation pair: English chrome offers Arabic, Arabic chrome offers
  // English. One key, correct in both directions.
  blogSwitchLanguage: { en: "Read this site in Arabic", ar: "اقرأ هذا الموقع بالإنجليزية" },
  blogBackToTop: { en: "Back to top", ar: "العودة للأعلى" },

  // ── Blog lists: home, topics, dashboard ─────────────────────────────────
  blogWritings: { en: "Writings", ar: "كتابات" },
  blogLatest: { en: "Latest", ar: "الأحدث" },
  blogLatestWritings: { en: "Latest writings", ar: "أحدث الكتابات" },
  blogMostDiscussed: { en: "Most discussed", ar: "الأكثر نقاشًا" },
  blogNothingPublished: { en: "Nothing published here yet.", ar: "لا شيء منشور هنا بعد." },
  blogFilteredByLanguage: {
    en: "This site lists only notes written in its own language.",
    ar: "يعرض هذا الموقع الملاحظات المكتوبة بلغته فقط.",
  },
  blogNoTopicWritings: { en: "No writings under this topic.", ar: "لا كتابات تحت هذا الموضوع." },
  blogChangeBanner: { en: "Change banner…", ar: "تغيير الغلاف…" },

  // ── Blog article ────────────────────────────────────────────────────────
  blogShare: { en: "Share", ar: "مشاركة" },
  blogCopyLink: { en: "Copy link", ar: "نسخ الرابط" },
  blogLinkCopied: { en: "Link copied", ar: "تم نسخ الرابط" },
  blogCopyFailed: { en: "Could not copy the link", ar: "تعذر نسخ الرابط" },
  blogOlder: { en: "Older", ar: "أقدم" },
  blogNewer: { en: "Newer", ar: "أحدث" },
  blogMoreWritings: { en: "More writings", ar: "مزيد من الكتابات" },
  blogRelated: { en: "Related", ar: "ذات صلة" },
  blogRelatedWritings: { en: "Related writings", ar: "كتابات ذات صلة" },

  // ── Blog search (nav field + Ctrl/Cmd+K overlay) ────────────────────────
  blogSearchPlaceholder: { en: "Search writings…", ar: "بحث في الكتابات…" },
  blogSearchOpen: { en: "Search", ar: "بحث" },
  blogSearchClose: { en: "Close search", ar: "إغلاق البحث" },

  // ── Marginalia (reader comments) ────────────────────────────────────────
  marginalia: { en: "Marginalia", ar: "الحواشي" },
  marginaliaAria: { en: "Comments", ar: "التعليقات" },
  marginaliaEmpty: { en: "no notes yet", ar: "لا توجد حواشٍ بعد" },
  marginaliaName: { en: "Your name (optional)", ar: "اسمك (اختياري)" },
  marginaliaBody: { en: "Write in the margin…", ar: "اكتب في الهامش…" },
  marginaliaPost: { en: "Leave a note", ar: "اترك حاشية" },
  marginaliaFailed: { en: "Posting failed", ar: "فشل النشر" },
  marginaliaAnonymous: { en: "Anonymous", ar: "مجهول" },

  // ── Home banner modal (dashboard hero) ──────────────────────────────────
  homeBannerTitle: { en: "Home banner", ar: "غلاف الرئيسية" },
  homeBannerSubtitle: { en: "dashboard hero", ar: "واجهة اللوحة" },
  homeBannerAria: { en: "Change home banner", ar: "تغيير غلاف الرئيسية" },
  homeBannerSet: { en: "Home banner set", ar: "تم تعيين غلاف الرئيسية" },
  homeBannerRemoved: { en: "Home banner removed", ar: "تمت إزالة غلاف الرئيسية" },
  homeBannerFailed: { en: "Saving the banner failed", ar: "فشل حفظ الغلاف" },

  // ── Typography (settings panel) ─────────────────────────────────────────
  // The type SPECIMENS are not here: a Latin sample must stay Latin in an
  // Arabic UI (and the Arabic one Arabic in an English UI) or the preview
  // stops previewing what it claims to. They live in SettingsModal.tsx.
  groupTypography: { en: "Typography", ar: "الطباعة" },
  // Sub-heads inside the merged Appearance & language tab.
  groupTheme: { en: "Theme", ar: "السمة" },
  groupLanguage: { en: "Language & direction", ar: "اللغة والاتجاه" },
  typographyNote: {
    en: "Catalog faces are fetched once when you save, then served from your own machine — visitors never contact an external font host. A face that is not in the catalog can be uploaded below and is offered in every slot.",
    ar: "تُجلب خطوط الكتالوج مرة واحدة عند الحفظ، ثم تُقدَّم من جهازك — لا يتصل الزوار بأي مضيف خطوط خارجي. وما ليس في الكتالوج يمكن رفعه أدناه ليُتاح في كل الخانات.",
  },
  rowFontProse: { en: "Reading text", ar: "نص القراءة" },
  hintFontProse: { en: "reading column, editor prose", ar: "عمود القراءة ونص المحرر" },
  rowFontUi: { en: "Interface", ar: "الواجهة" },
  hintFontUi: { en: "sidebar, tabs, panels", ar: "الشريط الجانبي والألسنة واللوحات" },
  rowFontMono: { en: "Code", ar: "الشيفرة" },
  hintFontMono: { en: "code blocks, raw markdown", ar: "كتل الشيفرة وماركداون الخام" },
  // The Arabic slot is a different KIND of control from the three above it —
  // one face that answers for Arabic letters inside all of them — so it gets
  // its own sub-heading rather than a fourth row at the same visual rank.
  fontArabicHead: { en: "Arabic script", ar: "الخط العربي" },
  fontArabicHeadNote: {
    en: "Arabic letters in all three slots above, per character, size-matched to the Latin face.",
    ar: "الحروف العربية في الخانات الثلاث أعلاه، حرفًا حرفًا، بحجم مطابق للخط اللاتيني.",
  },
  rowFontArabic: { en: "Arabic face", ar: "الخط" },
  hintFontArabic: {
    en: "naskh for reading, kufi for chrome",
    ar: "النسخ للقراءة، والكوفي للواجهة",
  },
  fontSystem: { en: "system (no webfont)", ar: "خط النظام (بلا تنزيل)" },
  fontGroupSerif: { en: "Serif", ar: "بحرف مذيّل" },
  fontGroupSans: { en: "Sans-serif", ar: "بلا ذيول" },
  fontGroupMono: { en: "Monospace", ar: "ثابت العرض" },
  fontGroupArabicNaskh: { en: "Naskh & classical", ar: "نسخ وخطوط كلاسيكية" },
  fontGroupArabicModern: { en: "Modern & kufi", ar: "حديثة وكوفية" },
  fontPreview: { en: "Preview", ar: "معاينة" },
  fontPreviewNote: {
    en: "Live — updates before you save.",
    ar: "مباشرة — تتحدث قبل الحفظ.",
  },
  // "…fonts", not "…to defaults": the button sits at the end of a section in a
  // five-section panel, one row above the next heading, and an unqualified
  // "Reset to defaults" there reads as if it resets the whole panel.
  fontReset: { en: "Reset fonts", ar: "إعادة تعيين الخطوط" },
  fontsFetchFailed: {
    en: "Could not fetch the fonts — settings were not changed",
    ar: "تعذر جلب الخطوط — لم تتغير الإعدادات",
  },
  fontFetching: { en: "Fetching fonts…", ar: "جارٍ جلب الخطوط…" },
  // The picker: a filter over twenty-seven catalog families plus whatever the
  // operator has uploaded.
  fontFilter: { en: "Filter fonts…", ar: "تصفية الخطوط…" },
  fontGroupCustom: { en: "Your fonts", ar: "خطوطك" },

  // ── Uploaded faces (VELLUM_DATA/fonts/custom) ───────────────────────────
  // The catalog answers "one of ours"; this answers "the one I own", which is
  // the only possible answer for a licensed Arabic face.
  fontCustomHead: { en: "Your own fonts", ar: "خطوطك الخاصة" },
  fontCustomNote: {
    en: "Upload a face you own and it appears under “Your fonts” in every slot above — reading text, interface, code and Arabic. Files are kept in your instance data directory (named in About) and served from this machine, like the catalog.",
    ar: "ارفع خطًا تملكه ليظهر تحت «خطوطك» في كل خانة أعلاه — نص القراءة والواجهة والشيفرة والعربية. تُحفظ الملفات في مجلد بيانات النسخة (المذكور في «حول») وتُقدَّم من هذا الجهاز، كما في الكتالوج.",
  },
  dropFont: { en: "Drop a font file, or click to choose", ar: "أفلت ملف خط، أو انقر للاختيار" },
  dropFontHint: {
    en: "woff2, woff, ttf or otf — up to {max} MB",
    ar: "‎woff2 أو woff أو ttf أو otf — حتى {max} ميغابايت",
  },
  noCustomFonts: { en: "No fonts uploaded yet.", ar: "لم تُرفع أي خطوط بعد." },
  fontSizeKb: { en: "{count} KB", ar: "{count} ك.ب" },
  // A face a slot still names has no delete button at all; the row says which
  // slot is holding it, so the way out is obvious.
  fontInUse: { en: "in use — {slots}", ar: "قيد الاستخدام — {slots}" },
  fontAdded: { en: "Added {name}", ar: "أُضيف {name}" },
  fontUploadFailed: { en: "The font could not be uploaded", ar: "تعذر رفع الخط" },
  // ── What the SERVER refused, said here ──────────────────────────────────
  // The upload routes answer `{ error, code }`; `error` is English prose for a
  // log and `code` is what these translate. Before them, the commonest failure
  // of the whole feature — picking the wrong file — printed the server's
  // English sentence into a fully Arabic panel, and `fontUploadFailed` was
  // dead code. It is still the fallback for a code nothing here names.
  errFontUnrecognized: {
    en: "That is not a font file. Choose a woff2, woff, ttf or otf.",
    ar: "هذا ليس ملف خط. اختر ملفًا بصيغة woff2 أو woff أو ttf أو otf.",
  },
  errFontDamaged: {
    en: "That font file is damaged and no browser could render it.",
    ar: "ملف الخط تالف ولن يتمكن أي متصفح من عرضه.",
  },
  errFontTooLarge: {
    en: "That font file is larger than {max} MB.",
    ar: "حجم ملف الخط أكبر من {max} ميغابايت.",
  },
  errFontNoFile: { en: "No file was received.", ar: "لم يُستلم أي ملف." },
  errFontNotFound: { en: "That font is no longer on this instance.", ar: "لم يعد هذا الخط موجودًا في هذه النسخة." },
  errFontBadName: { en: "That font file name is not one this instance created.", ar: "اسم ملف الخط هذا ليس مما أنشأته هذه النسخة." },
  errFontNoFreeName: {
    en: "Too many fonts share that name. Rename the file and try again.",
    ar: "خطوط كثيرة تحمل هذا الاسم. غيّر اسم الملف وأعد المحاولة.",
  },
  errFontInUse: {
    en: "That face is still in use. Choose another one in the slots above first.",
    ar: "هذا الخط ما زال قيد الاستخدام. اختر خطًا آخر في الخانات أعلاه أولًا.",
  },
  fontDeleteTitle: { en: "Remove “{name}”?", ar: "إزالة «{name}»؟" },
  fontDeleteBody: {
    en: "The file is deleted from this instance. Your notes are untouched, and you can upload it again.",
    ar: "سيُحذف الملف من هذه النسخة. لن تُمس ملاحظاتك، ويمكنك رفعه مجددًا.",
  },
  fontRemoved: { en: "Font removed", ar: "أُزيل الخط" },
  fontRemoveFailed: { en: "The font could not be removed", ar: "تعذرت إزالة الخط" },

  // The optical dial: the only number in the panel a reader arrives at by eye,
  // set against the specimen block two rows above it.
  rowSizeAdjust: { en: "Arabic size match", ar: "مطابقة حجم العربي" },
  hintSizeAdjust: {
    en: "scales the Arabic face against the Latin one",
    ar: "يضبط حجم الخط العربي مقابل اللاتيني",
  },
  sizeAdjustAuto: { en: "auto", ar: "تلقائي" },
  errSizeAdjust: {
    en: "Must be between {min} and {max} percent",
    ar: "يجب أن يكون بين {min} و{max} بالمئة",
  },

  // ── Backup & sync (git) ─────────────────────────────────────────────────
  groupSync: { en: "Backup & sync", ar: "النسخ الاحتياطي والمزامنة" },
  syncNote: {
    en: "Commit the vault and push it to a private git remote you own. Off until you turn it on.",
    ar: "يودع الخزانة ويرفعها إلى مستودع git خاص بك. معطّل حتى تُفعّله.",
  },
  rowSyncEnabled: { en: "Backup", ar: "النسخ الاحتياطي" },
  hintSyncEnabled: { en: "master switch", ar: "المفتاح الرئيسي" },
  // Shown in place of the live section while the master switch is off: six
  // fields and two buttons at full contrast, all of them inert, read as a
  // configured-and-running backup at a glance.
  syncOffNotice: {
    en: "Backup is off. Turn it on to configure and run it.",
    ar: "النسخ الاحتياطي معطّل. فعّله لضبطه وتشغيله.",
  },
  rowSyncRemote: { en: "Remote URL", ar: "عنوان المستودع البعيد" },
  hintSyncRemote: { en: "https:// or git@host:path", ar: "‎https://‎ أو ‎git@host:path‎" },
  phSyncRemote: { en: "https://host/you/vault.git", ar: "https://المضيف/vault.git" },
  rowSyncBranch: { en: "Branch", ar: "الفرع" },
  hintSyncBranch: { en: "committed and pushed", ar: "الفرع الذي يُودع ويُرفع" },
  rowSyncAuth: { en: "Authentication", ar: "المصادقة" },
  hintSyncAuth: { en: "how this server signs in", ar: "كيف يسجّل الخادم دخوله" },
  authSsh: { en: "SSH keys (this machine)", ar: "مفاتيح SSH (هذا الجهاز)" },
  authToken: { en: "Access token", ar: "رمز وصول" },
  rowSyncUser: { en: "Username", ar: "اسم المستخدم" },
  hintSyncUser: { en: "paired with the token", ar: "مقترن بالرمز" },
  phSyncUser: { en: "your git username", ar: "اسم مستخدم git الخاص بك" },
  rowSyncToken: { en: "Access token", ar: "رمز الوصول" },
  hintSyncToken: {
    en: "write-only; stored outside the vault",
    ar: "للكتابة فقط؛ يُحفظ خارج الخزانة",
  },
  phTokenStored: { en: "replace the stored token", ar: "استبدال الرمز المحفوظ" },
  phTokenNew: { en: "paste a token", ar: "الصق رمزًا" },
  tokenSetYes: { en: "A token is stored.", ar: "يوجد رمز محفوظ." },
  tokenSetNo: { en: "No token stored.", ar: "لا يوجد رمز محفوظ." },
  clearToken: { en: "Clear token", ar: "مسح الرمز" },
  tokenCleared: { en: "Token cleared", ar: "تم مسح الرمز" },
  rowSyncPull: { en: "Pull first", ar: "السحب أولًا" },
  hintSyncPull: {
    en: "fast-forward only; never merges",
    ar: "تقديم سريع فقط؛ لا يدمج أبدًا",
  },
  // "Every" + a bare "0" + "minutes; 0 = manual only" made the reader decode a
  // magic number to learn the setting was off. The choice is a small closed
  // set, so it is a select whose options are sentences.
  rowSyncInterval: { en: "Automatic sync", ar: "المزامنة التلقائية" },
  hintSyncInterval: { en: "unattended, in the background", ar: "تلقائيًا في الخلفية" },
  syncIntervalManual: { en: "Manual only", ar: "يدويًا فقط" },
  syncIntervalMinutes: { en: "Every {count} minutes", ar: "كل {count} دقيقة" },
  syncIntervalHourly: { en: "Every hour", ar: "كل ساعة" },
  syncIntervalHours: { en: "Every {count} hours", ar: "كل {count} ساعات" },
  syncIntervalDaily: { en: "Once a day", ar: "مرة كل يوم" },
  rowSyncStatus: { en: "Status", ar: "الحالة" },
  hintSyncStatus: { en: "this vault's repository", ar: "مستودع هذه الخزانة" },
  syncNow: { en: "Sync now", ar: "زامن الآن" },
  // Precise, like every other label in this column — and it LEAVES once the
  // vault is a repository rather than sitting there greyed forever.
  syncInitialize: { en: "Initialize repository", ar: "تهيئة المستودع" },
  syncing: { en: "Syncing…", ar: "جارٍ المزامنة…" },
  syncSaveFirst: {
    en: "Save these settings before syncing.",
    ar: "احفظ هذه الإعدادات قبل المزامنة.",
  },
  syncErrorShort: { en: "failed", ar: "فشلت" },
  syncFailed: { en: "Sync failed", ar: "فشلت المزامنة" },
  syncPushed: { en: "Vault committed and pushed", ar: "تم إيداع الخزانة ورفعها" },
  syncUpToDate: {
    en: "Nothing to commit — already up to date",
    ar: "لا شيء لإيداعه — كل شيء محدّث",
  },
  // Distinct from both: nothing new to COMMIT, but commits that were only
  // local are now on the remote. The first sync after "Make it a repo" is
  // always this one, and calling it "already up to date" hid a whole upload.
  syncPushedOnly: {
    en: "Pushed — nothing new to commit",
    ar: "تم الرفع — لا جديد لإيداعه",
  },
  syncInitDone: { en: "The vault is a git repository now", ar: "أصبحت الخزانة مستودع git" },
  syncNotRepo: { en: "The vault is not a git repository yet.", ar: "الخزانة ليست مستودع git بعد." },
  syncNoRemote: { en: "no remote", ar: "بلا مستودع بعيد" },
  syncOnBranch: { en: "On {branch} → {host}", ar: "على {branch} ← {host}" },
  syncTokenMissing: {
    en: "Token mode is selected but no token is stored.",
    ar: "وضع الرمز مُختار لكن لا يوجد رمز محفوظ.",
  },
  syncTipBranch: { en: "Branch {branch} → {host}", ar: "الفرع {branch} ← {host}" },
  syncTipNoRepo: { en: "Not a git repository yet", ar: "ليست مستودع git بعد" },
  syncTipClean: { en: "Nothing uncommitted", ar: "لا شيء غير مودع" },
  syncTipDirty: { en: "{count} uncommitted", ar: "{count} غير مودع" },
  // Two separate strings, not one "{ahead} ahead · {behind} behind": in Arabic
  // that single line reordered into "٠ متقدم ٠٠ متأخر", the two counts colliding
  // into an unreadable run. Each count now renders in its own isolated chip.
  syncAhead: { en: "{count} ahead", ar: "{count} متقدم" },
  syncBehind: { en: "{count} behind", ar: "{count} متأخر" },
  // The third state ahead/behind needs. There is no remote-tracking ref until
  // a fetch or a push has succeeded once, and calling that "0 ahead · 0 behind"
  // is character-for-character what a fully backed-up vault reads.
  syncNoTracking: {
    en: "Nothing has reached the remote yet",
    ar: "لم يصل شيء إلى المستودع البعيد بعد",
  },
  // A failure line leads with the cause WE can state; git's own words stay
  // underneath it, verbatim and quotable, because that text is the diagnosis.
  syncGitSaid: { en: "git said:", ar: "قال git:" },
  syncNoRemoteSet: { en: "No remote URL is set.", ar: "لم يُضبط عنوان المستودع البعيد." },
  syncCopyError: { en: "Copy the error", ar: "نسخ الخطأ" },
  syncCopied: { en: "Copied", ar: "تم النسخ" },
  syncDetails: { en: "Backup details", ar: "تفاصيل النسخ الاحتياطي" },
  syncOpenSettings: { en: "Backup settings", ar: "إعدادات النسخ الاحتياطي" },
  cmdSyncHint: { en: "backup", ar: "النسخ الاحتياطي" },
  errRemoteScheme: {
    en: "Must start with https:// , ssh:// or git@host:path",
    ar: "يجب أن يبدأ بـ ‎https://‎ أو ‎ssh://‎ أو ‎git@host:path‎",
  },
  errRemoteChars: {
    en: "A git remote cannot hold spaces or shell characters",
    ar: "لا يمكن أن يحتوي العنوان على مسافات أو رموز صدفة",
  },
  errRemoteCreds: {
    en: "Do not put credentials in an https:// URL — use the token field",
    ar: "لا تضع بيانات اعتماد في عنوان ‎https://‎ — استخدم حقل الرمز",
  },
  errBranchName: { en: "Not a valid branch name", ar: "اسم فرع غير صالح" },
  errInterval: { en: "Whole minutes, 0 to 1440", ar: "دقائق صحيحة، من ٠ إلى ١٤٤٠" },
  errTokenSpaces: { en: "A token cannot contain spaces", ar: "لا يمكن أن يحتوي الرمز على مسافات" },

  // ── Settings panel navigation ───────────────────────────────────────────
  // The panel outgrew one flat scroll (five sections, four screens of it), so
  // it has a section rail — the same reason Obsidian's settings has one.
  settingsSections: { en: "Settings sections", ar: "أقسام الإعدادات" },
  // An empty field that inherits an env default and a field holding a muted
  // value looked identical. The badge says which one this is, so the
  // convention no longer has to be explained in a note at the top.
  // The middle state of a three-way row: not on, not off, TAKE THE ENV
  // DEFAULT. A checkbox cannot express it, which is why these rows are
  // segmented controls; the segment carries the value in force as its note.
  inheritSegment: { en: "Inherit", ar: "موروث" },
  // The generic filter field inside a select popover (the font picker names
  // its own).
  filterPlaceholder: { en: "Filter…", ar: "تصفية…" },
  remove: { en: "Remove", ar: "إزالة" },
  inheritedBadge: { en: "inherited", ar: "موروث" },

  // ── Mode indicators ─────────────────────────────────────────────────────
  // A mode that removes the ability to type must say so where the eye already
  // is (the status bar) AND where the hands are (the editor column). These are
  // the pills; the strip copy is below them.
  modeRead: { en: "Reading", ar: "قراءة" },
  modeVim: { en: "Vim", ar: "وضع vim" },
  modePreview: { en: "Preview", ar: "معاينة" },
  modeReadOnTitle: {
    en: "Reading mode is ON — typing is off. Click (or Ctrl/Cmd+E) to edit.",
    ar: "وضع القراءة مُفعَّل — الكتابة متوقفة. انقر (أو Ctrl/Cmd+E) للتحرير.",
  },
  modeReadOffTitle: {
    en: "Editing. Click (or Ctrl/Cmd+E) for reading mode.",
    ar: "وضع التحرير. انقر (أو Ctrl/Cmd+E) للانتقال إلى وضع القراءة.",
  },
  modeVimOnTitle: {
    en: "Vim keybindings are ON — click to turn them off.",
    ar: "اختصارات vim مُفعَّلة — انقر لإيقافها.",
  },
  modeVimOffTitle: {
    en: "Vim keybindings are off — click to turn them on.",
    ar: "اختصارات vim متوقفة — انقر لتفعيلها.",
  },
  modePreviewTitle: {
    en: "Previewing as a visitor — click (or Esc) to return to the app.",
    ar: "معاينة كزائر — انقر (أو Esc) للعودة إلى التطبيق.",
  },
  modesLabel: { en: "Modes", ar: "الأوضاع" },
  // Vim's SUB-mode. "Vim is on" and "the keys under your fingers are commands
  // right now" are different facts, and only the second one traps a reader —
  // so the pill carries the sub-mode beside the name and vim's own panel at
  // the foot of the editor spells it out in full.
  vimNormal: { en: "NORMAL", ar: "أوامر" },
  vimInsert: { en: "INSERT", ar: "إدراج" },
  vimVisual: { en: "VISUAL", ar: "تحديد" },
  vimReplace: { en: "REPLACE", ar: "استبدال" },
  vimNormalTitle: {
    en: "Vim NORMAL mode — keys are commands, not text. Press i to type; click to leave vim.",
    ar: "وضع vim العادي — المفاتيح أوامر لا نص. اضغط i للكتابة؛ انقر للخروج من vim.",
  },
  vimInsertTitle: {
    en: "Vim INSERT mode — keys type text. Press Esc for commands; click to leave vim.",
    ar: "وضع الإدراج في vim — المفاتيح تكتب نصًا. اضغط Esc للأوامر؛ انقر للخروج من vim.",
  },
  vimVisualTitle: {
    en: "Vim VISUAL mode — keys extend the selection. Press Esc; click to leave vim.",
    ar: "وضع التحديد في vim — المفاتيح توسّع التحديد. اضغط Esc؛ انقر للخروج من vim.",
  },
  vimReplaceTitle: {
    en: "Vim REPLACE mode — typing overwrites. Press Esc; click to leave vim.",
    ar: "وضع الاستبدال في vim — الكتابة تستبدل النص. اضغط Esc؛ انقر للخروج من vim.",
  },
  // The in-workspace strip: one line, part of the layout, never an overlay.
  readingStrip: { en: "Reading — this note is read-only", ar: "قراءة — هذه الملاحظة للقراءة فقط" },
  readingStripAction: { en: "Edit (Ctrl/Cmd+E)", ar: "تحرير (Ctrl/Cmd+E)" },
  // Zen takes the status bar to zero height, so in zen the pills are gone and
  // the strip is the only place a mode can live. Reading already had one;
  // ZEN + VIM was a modal editor with no on-screen state at all.
  vimStripNormal: {
    en: "Vim NORMAL — keys are commands, not text. Press i to type.",
    ar: "vim العادي — المفاتيح أوامر لا نص. اضغط i للكتابة.",
  },
  vimStripInsert: {
    en: "Vim INSERT — keys type text. Esc returns to commands.",
    ar: "إدراج vim — المفاتيح تكتب نصًا. Esc يعيدك إلى الأوامر.",
  },
  vimStripVisual: {
    en: "Vim VISUAL — keys extend the selection. Esc returns to commands.",
    ar: "تحديد vim — المفاتيح توسّع التحديد. Esc يعيدك إلى الأوامر.",
  },
  vimStripReplace: {
    en: "Vim REPLACE — typing overwrites. Esc returns to commands.",
    ar: "استبدال vim — الكتابة تستبدل النص. Esc يعيدك إلى الأوامر.",
  },
  vimStripAction: { en: "Leave vim", ar: "الخروج من vim" },
  previewStripHint: {
    en: "This is exactly what a visitor sees",
    ar: "هذا ما يراه الزائر تمامًا",
  },
  exitPreviewTitle: { en: "Exit preview (Esc)", ar: "إنهاء المعاينة (Esc)" },

  // ── Status-bar panel toggles ────────────────────────────────────────────
  enterZen: { en: "Zen mode (Ctrl/Cmd+Shift+Z)", ar: "وضع التركيز (Ctrl/Cmd+Shift+Z)" },

  // ── Keyboard shortcuts overlay (Ctrl/Cmd+/) ─────────────────────────────
  shortcutsTitle: { en: "Keyboard shortcuts", ar: "اختصارات لوحة المفاتيح" },
  shortcutsTitleKey: {
    en: "Keyboard shortcuts (Ctrl/Cmd+/)",
    ar: "اختصارات لوحة المفاتيح (Ctrl/Cmd+/)",
  },
  shortcutsPlaceholder: { en: "Search shortcuts…", ar: "بحث في الاختصارات…" },
  scGroupNav: { en: "Navigation", ar: "التنقل" },
  scGroupEditing: { en: "Editing", ar: "التحرير" },
  scGroupModes: { en: "Modes", ar: "الأوضاع" },
  scGroupPublishing: { en: "Publishing", ar: "النشر" },
  scGroupPanels: { en: "Panels", ar: "اللوحات" },
  scPalette: { en: "Command palette", ar: "لوحة الأوامر" },
  scSearch: { en: "Search notes", ar: "بحث في الملاحظات" },
  scGraph: { en: "Graph view", ar: "عرض المخطط" },
  scFollowLink: { en: "Follow a [[wikilink]]", ar: "فتح رابط ‎[[wikilink]]‎" },
  scFollowLinkKey: { en: "Click", ar: "نقرة" },
  scOpenFile: { en: "Open an image or PDF from the tree", ar: "فتح صورة أو ملف PDF من الشجرة" },
  scWalkFiles: { en: "Next / previous file in the folder", ar: "الملف التالي/السابق في المجلد" },
  scEscape: { en: "Close an overlay, leave zen or preview", ar: "إغلاق طبقة، أو مغادرة التركيز/المعاينة" },
  scEscapeBlog: { en: "Close an overlay, leave preview", ar: "إغلاق طبقة، أو مغادرة المعاينة" },
  scSave: { en: "Save now", ar: "حفظ فوري" },
  scUndo: { en: "Undo", ar: "تراجع" },
  scRedo: { en: "Redo", ar: "إعادة" },
  scFind: { en: "Find in this note", ar: "بحث داخل الملاحظة" },
  scMoveLine: { en: "Move line up / down", ar: "نقل السطر لأعلى/لأسفل" },
  scSlash: { en: "Insert a block (callout, table, code…)", ar: "إدراج كتلة (تنبيه، جدول، شيفرة…)" },
  scSlashKey: { en: "/ at line start", ar: "‎/‎ في بداية السطر" },
  scFold: { en: "Fold a section", ar: "طي قسم" },
  scFoldKey: { en: "or the chevron beside a heading", ar: "أو السهم بجانب العنوان" },
  scFoldAll: { en: "Fold / unfold everything", ar: "طي كل الأقسام أو فتحها" },
  scViaPalette: { en: "Command palette", ar: "لوحة الأوامر" },
  scViaStatusBar: { en: "Status bar", ar: "شريط الحالة" },
  scHelp: { en: "This list", ar: "هذه القائمة" },

  // ── Moving things (drag in the tree, "Move to…", undo) ────────────────────
  // Every one of these is reachable without a mouse: the row menu and the
  // palette open the same picker the drag ends in, and the undo is a real
  // <button> in the toast, not a gesture.
  moveTo: { en: "Move to…", ar: "نقل إلى…" },
  cmdMoveCurrent: { en: "Move note to…", ar: "نقل الملاحظة إلى…" },
  cmdMoveFolderHint: { en: "picks a folder", ar: "اختيار مجلد" },
  moveToTitle: { en: "Move “{name}” to…", ar: "نقل “{name}” إلى…" },
  moveAction: { en: "Move", ar: "نقل" },
  moveFilter: { en: "Filter folders…", ar: "تصفية المجلدات…" },
  moveVaultRoot: { en: "Vault root", ar: "جذر الخزانة" },
  moveNoFolders: { en: "No folder matches.", ar: "لا يوجد مجلد مطابق." },
  moveNowhere: {
    en: "There is nowhere else to put it — the vault has no other folder.",
    // «الخزانة» is feminine, so the verb is تحتوي, not يحتوي.
    ar: "لا مكان آخر له — لا تحتوي الخزانة على مجلد آخر.",
  },
  // The conflict dialog. It offers a NAME, never an overwrite: the two files
  // both exist and the reader decides which name the arriving one keeps.
  moveConflictTitle: { en: "“{name}” is already there", ar: "“{name}” موجود هناك بالفعل" },
  moveConflictBody: {
    en: "{folder} already holds a “{name}”. Give this one another name, or cancel.",
    ar: "يحتوي {folder} على “{name}” بالفعل. اختر اسمًا آخر لهذا، أو ألغِ النقل.",
  },
  moveNameTaken: { en: "That name is taken here too.", ar: "هذا الاسم مأخوذ هنا أيضًا." },
  moveNameSlash: { en: "A name cannot contain “/”.", ar: "لا يمكن أن يحتوي الاسم على “/”." },
  moveNameDot: { en: "A name cannot start with “.”.", ar: "لا يمكن أن يبدأ الاسم بنقطة “.”." },
  moveLands: { en: "Lands at {path}", ar: "سيستقر في {path}" },
  moveCurrently: { en: "Currently in {folder}", ar: "موجود حاليًا في {folder}" },
  // The toast. It names BOTH ends, because the whole risk of a drag is landing
  // somewhere you were not looking.
  movedToast: { en: "Moved “{name}” from {from} to {to}", ar: "نُقل “{name}” من {from} إلى {to}" },
  moveUndoneToast: { en: "Move undone — “{name}” is back in {folder}", ar: "أُلغي النقل — عاد “{name}” إلى {folder}" },
  undo: { en: "Undo", ar: "تراجع" },
  // Refusals. The server names a code for each; the generic line is the
  // fallback for anything it has not named.
  moveFailed: { en: "Could not move “{name}”.", ar: "تعذّر نقل “{name}”." },
  moveNotAllowed: { en: "That folder cannot take “{name}”.", ar: "لا يمكن لهذا المجلد استقبال “{name}”." },
  moveIntoSelfError: { en: "A folder cannot move inside itself.", ar: "لا يمكن نقل مجلد إلى داخل نفسه." },
  moveConflictError: { en: "“{name}” already exists there.", ar: "“{name}” موجود هناك بالفعل." },
  moveGoneError: { en: "“{name}” is no longer there.", ar: "“{name}” لم يعد موجودًا." },
  // Files dragged in from the desktop onto a folder row. The landed NAME is in
  // the message because the server takes the first free one — a counter the
  // reader does not see is a file they will not find.
  uploadedOneToast: { en: "Added “{name}” to {folder}", ar: "أُضيف “{name}” إلى {folder}" },
  uploadedManyToast: { en: "Added {count} to {folder}", ar: "أُضيف {count} إلى {folder}" },
  uploadIntoFailed: { en: "Could not add “{name}”.", ar: "تعذّرت إضافة “{name}”." },
  uploadNotImage: { en: "“{name}” is not an image the vault accepts.", ar: "“{name}” ليس صورة تقبلها الخزانة." },

  // ── Text formatting, the selection menu and colour ──────────────────────
  // Added with the formatting round. Ctrl/Cmd+B stopped folding a pane and
  // started making text bold, so the sheet needs a group that says so, and
  // the menu needs a full vocabulary in both languages. The colour names are
  // written out one by one rather than composed at the call site: the i18n
  // gate counts a key as used only when it appears as a quoted token, and a
  // template-literal key would report all nine as dead.
  scGroupFormatting: { en: "Formatting", ar: "التنسيق" },
  scBold: { en: "Bold", ar: "عريض" },
  scItalic: { en: "Italic", ar: "مائل" },
  scUnderline: { en: "Underline", ar: "تحته خط" },
  scStrikethrough: { en: "Strikethrough", ar: "يتوسطه خط" },
  scHighlight: { en: "Highlight", ar: "تظليل" },
  scSelectionMenu: { en: "Formatting menu for the selection", ar: "قائمة تنسيق التحديد" },
  scSelectionMenuKey: { en: "Right-click, or Shift+F10", ar: "نقر يمين، أو Shift+F10" },
  scTextColor: { en: "Text colour", ar: "لون النص" },
  scViaSelectionMenu: { en: "Selection menu", ar: "قائمة التحديد" },

  selMenuTitle: { en: "Formatting", ar: "التنسيق" },
  selMenuBack: { en: "Back", ar: "رجوع" },
  selGroupStyle: { en: "Text style", ar: "نمط النص" },
  selGroupStructure: { en: "Structure", ar: "البنية" },
  selGroupInsert: { en: "Insert", ar: "إدراج" },
  selGroupColor: { en: "Colour", ar: "اللون" },
  fmtBold: { en: "Bold", ar: "عريض" },
  fmtItalic: { en: "Italic", ar: "مائل" },
  fmtUnderline: { en: "Underline", ar: "تحته خط" },
  fmtStrikethrough: { en: "Strikethrough", ar: "يتوسطه خط" },
  fmtHighlight: { en: "Highlight", ar: "تظليل" },
  fmtCode: { en: "Inline code", ar: "شفرة داخل السطر" },
  fmtHeading1: { en: "Heading 1", ar: "عنوان ١" },
  fmtHeading2: { en: "Heading 2", ar: "عنوان ٢" },
  fmtHeading3: { en: "Heading 3", ar: "عنوان ٣" },
  fmtBulletList: { en: "Bulleted list", ar: "قائمة نقطية" },
  fmtNumberedList: { en: "Numbered list", ar: "قائمة مرقّمة" },
  fmtTaskList: { en: "Task list", ar: "قائمة مهام" },
  fmtQuote: { en: "Quote", ar: "اقتباس" },
  insWikilink: { en: "Wikilink", ar: "رابط داخلي" },
  insLink: { en: "Link", ar: "رابط" },
  insMath: { en: "Inline math", ar: "رياضيات داخل السطر" },
  insCodeBlock: { en: "Code block", ar: "كتلة شفرة" },
  // The two tiers, named by what they DO rather than by their implementation.
  // The notes are the whole argument in one line each, because the choice
  // between them is a real one and the reader is making it here.
  colorThemeAware: { en: "Theme-aware", ar: "متوافق مع السمة" },
  colorThemeAwareNote: {
    en: "Follows the theme — stays legible in all fifteen, light and dark.",
    ar: "يتبع السمة — يبقى مقروءًا في السمات الخمس عشرة، الفاتحة والداكنة.",
  },
  colorFixed: { en: "Fixed ink", ar: "لون ثابت" },
  colorFixedNote: {
    en: "One exact colour, whatever the theme. Readable everywhere, sharpest on some.",
    ar: "لون واحد محدّد مهما كانت السمة. مقروء في كل مكان، وأوضح في بعضها.",
  },
  colorRemove: { en: "Remove colour", ar: "إزالة اللون" },
  colorRed: { en: "Red", ar: "أحمر" },
  colorOrange: { en: "Orange", ar: "برتقالي" },
  colorAmber: { en: "Amber", ar: "كهرماني" },
  colorGreen: { en: "Green", ar: "أخضر" },
  colorTeal: { en: "Teal", ar: "أزرق مخضرّ" },
  colorBlue: { en: "Blue", ar: "أزرق" },
  colorViolet: { en: "Violet", ar: "بنفسجي" },
  colorMagenta: { en: "Magenta", ar: "أرجواني" },
  colorGrey: { en: "Grey", ar: "رمادي" },
  selToolbarLabel: { en: "Formatting toolbar", ar: "شريط التنسيق" },
  selToolbarHide: { en: "Hide the floating toolbar", ar: "إخفاء الشريط العائم" },
  selToolbarShow: { en: "Show the floating toolbar", ar: "إظهار الشريط العائم" },
  cmdSelectionToolbar: { en: "Floating formatting toolbar", ar: "شريط التنسيق العائم" },
  cmdSelectionToolbarHint: {
    en: "Appears over a selection",
    ar: "يظهر فوق النص المحدّد",
  },

  // ── LaTeX notes (.tex / .latex) ──────────────────────────────────────────
  // A `.tex` note is a note like any other, so its chrome is localized like
  // any other. Only the words LaTeX itself has and markdown does not live
  // here: numbered floats, theorem environments, a bibliography.
  texAbstract: { en: "Abstract", ar: "الملخّص" },
  texContents: { en: "Contents", ar: "المحتويات" },
  texReferences: { en: "References", ar: "المراجع" },
  texFigure: { en: "Figure", ar: "شكل" },
  texTable: { en: "Table", ar: "جدول" },
  texTheorem: { en: "Theorem", ar: "مبرهنة" },
  texLemma: { en: "Lemma", ar: "قضية مساعدة" },
  texProposition: { en: "Proposition", ar: "قضية" },
  texCorollary: { en: "Corollary", ar: "نتيجة" },
  texDefinition: { en: "Definition", ar: "تعريف" },
  texRemark: { en: "Remark", ar: "ملحوظة" },
  texExample: { en: "Example", ar: "مثال" },
  texProof: { en: "Proof", ar: "برهان" },
  // An unimplemented command renders as a muted dot, never as raw source; the
  // tooltip is the only place its name is ever shown.
  texUnsupportedCommand: {
    en: "{name} is not rendered here",
    ar: "لا يُعرض {name} هنا",
  },
  texUnresolvedRef: {
    en: "No note in this vault defines {key}",
    ar: "لا توجد ملاحظة في هذه الخزانة تعرّف {key}",
  },
  texRefIn: { en: "{title} — in {note}", ar: "{title} — في {note}" },
  texCiteOpens: { en: "Opens {note}", ar: "يفتح {note}" },
  cmdCopyVellumSty: {
    en: "LaTeX: download vellum.sty",
    ar: "لاتخ: تنزيل ملف vellum.sty",
  },
  cmdCopyVellumStyHint: {
    en: "The macro package that makes a .tex note compile outside Vellum",
    ar: "حزمة الماكرو التي تجعل ملاحظة ‎.tex‎ تُترجم خارج ڤيلوم",
  },
  newTexNote: { en: "New LaTeX note", ar: "ملاحظة لاتخ جديدة" },

  // ── Sectioning (heading menu, outline drag, focus, numbering) ─────────────
  // A heading is a HANDLE on a subtree, and every string here names an action
  // on that subtree rather than on the line the reader clicked.
  sectionActions: { en: "Section actions", ar: "إجراءات القسم" },
  copySectionLink: { en: "Copy link to section", ar: "نسخ رابط القسم" },
  copySectionMd: { en: "Copy section as Markdown", ar: "نسخ القسم بصيغة ماركداون" },
  extractSection: { en: "Extract section to a new note", ar: "استخراج القسم إلى ملاحظة جديدة" },
  selectSection: { en: "Select section", ar: "تحديد القسم" },
  focusSection: { en: "Focus section", ar: "إفراد القسم" },
  foldBelow: { en: "Fold all below", ar: "طي كل ما تحته" },
  unfoldBelow: { en: "Unfold all below", ar: "توسيع كل ما تحته" },
  sectionLinkCopied: { en: "Link to section copied", ar: "نُسخ رابط القسم" },
  sectionCopied: { en: "Section copied", ar: "نُسخ القسم" },
  sectionCopyFailed: { en: "Could not copy — the clipboard refused", ar: "تعذّر النسخ — رفضت الحافظة" },
  sectionExtracted: {
    en: "Moved “{title}” into {path}",
    ar: "نُقل “{title}” إلى {path}",
  },
  sectionExtractUndone: { en: "Extraction undone", ar: "أُلغي الاستخراج" },
  sectionExtractFailed: { en: "Could not extract the section", ar: "تعذّر استخراج القسم" },
  sectionMoved: { en: "Moved “{title}”", ar: "نُقل “{title}”" },
  sectionMoveUndone: { en: "Move undone", ar: "أُلغي النقل" },
  sectionMoveFailed: { en: "Could not move the section", ar: "تعذّر نقل القسم" },
  // A mode that removes what is on screen has to say so, and has to name the
  // way back in the same breath.
  focusSectionOn: { en: "Focused one section — Esc restores", ar: "أُفرد قسم واحد — Esc يعيد الباقي" },
  numberHeadings: { en: "Number the headings", ar: "ترقيم العناوين" },
  unnumberHeadings: { en: "Stop numbering the headings", ar: "إيقاف ترقيم العناوين" },
  scGroupSections: { en: "Sections", ar: "الأقسام" },
  scPrevHeading: { en: "Previous heading", ar: "العنوان السابق" },
  scNextHeading: { en: "Next heading", ar: "العنوان التالي" },
  scFocusSection: { en: "Focus one section (Esc restores)", ar: "إفراد قسم واحد (Esc يعيد الباقي)" },
  scSectionMenu: { en: "Section actions on a heading", ar: "إجراءات القسم على عنوان" },
  scSectionMenuKey: { en: "Right-click a heading, or ⋯", ar: "نقر يمين على عنوان، أو ⋯" },
  scReorderSection: { en: "Reorder a whole section", ar: "إعادة ترتيب قسم كامل" },
  scViaOutlineDrag: { en: "Drag a row in Outline", ar: "سحب صف في المخطط" },

  // ── Banners: the value that named nothing ────────────────────────────────
  // A banner used to vanish when it failed to load, which made a typo and "no
  // banner" identical on screen. These are what the ADMIN surfaces say
  // instead; a visitor still sees nothing.
  bannerMissing: { en: "Banner image not found", ar: "لم يُعثر على صورة الغلاف" },
  bannerMissingTitle: {
    en: "No file in the vault matches “{value}”",
    ar: "لا يوجد ملف في الخزانة يطابق “{value}”",
  },

  // ── Templates ────────────────────────────────────────────────────────────
  cmdInsertTemplate: { en: "Insert template…", ar: "إدراج قالب…" },
  cmdNewFromTemplate: { en: "New note from template…", ar: "ملاحظة جديدة من قالب…" },
  templateFilterPlaceholder: { en: "Search templates…", ar: "بحث في القوالب…" },
  templatePreviewHint: { en: "Pick a template to preview it", ar: "اختر قالبًا لمعاينته" },
  templateEmptyBody: { en: "This template has no body — only properties.", ar: "هذا القالب بلا متن — خصائص فقط." },
  // The picker's preview shows the template's FRONTMATTER as well as its body:
  // two templates whose bodies are both "# {{title}}" are told apart by these
  // rows and by nothing else, and one of them may publish the note.
  // A name the vault cannot address: `[`, `]`, `#` and `|` end or re-open a
  // wikilink, and an extraction leaves `[[<this name>]]` behind.
  promptNoLinkChars: {
    en: "A name cannot contain [ ] # or |",
    ar: "لا يمكن أن يحتوي الاسم على ‎[ ] # أو |‎",
  },
  // Why a note whose frontmatter says `align: justify` is set flush anyway.
  layoutHardWrapped: {
    en: "set flush — this note’s paragraphs are wrapped by hand",
    ar: "يُضبط على الحافة — فقرات هذه الملاحظة ملفوفة يدويًا",
  },
  templateSetsProps: { en: "Properties it sets", ar: "الخصائص التي يضبطها" },
  templateNoProps: { en: "No properties — body only", ar: "بلا خصائص — متن فقط" },
  templateBodyLabel: { en: "Body", ar: "المتن" },
  templatePublishWarn: {
    en: "Publishes the note to the public site",
    ar: "ينشر الملاحظة على الموقع العلني",
  },
  templatesNoFolder: {
    en: "No templates folder yet. Name one in Settings → Vault.",
    ar: "لا يوجد مجلد قوالب بعد. حدّده في الإعدادات ← الخزانة.",
  },
  templatesFolderEmpty: { en: "“{folder}” holds no notes yet.", ar: "المجلد “{folder}” لا يحتوي ملاحظات بعد." },
  templatesFolderIs: { en: "Templates: {folder}", ar: "القوالب: {folder}" },
  templatesFolderDetected: { en: "Templates: {folder} (detected)", ar: "القوالب: {folder} (مكتشف تلقائيًا)" },
  templatesFailed: { en: "Could not load the templates.", ar: "تعذّر تحميل القوالب." },
  templateInserted: { en: "Inserted “{name}”", ar: "أُدرج “{name}”" },
  templateFailed: { en: "Applying the template failed", ar: "فشل تطبيق القالب" },
  defaultTemplateFailed: {
    en: "The default template could not be applied — the note is empty",
    ar: "تعذّر تطبيق القالب الافتراضي — الملاحظة فارغة",
  },
  // Settings rows.
  templatesSection: { en: "Templates", ar: "القوالب" },
  templatesFolderLabel: { en: "Templates folder", ar: "مجلد القوالب" },
  templatesFolderHint: {
    en: "Vault-relative folder holding your template notes. Its notes never appear in the blog’s post list. Leave it empty and a folder named Templates is found automatically.",
    ar: "مجلد داخل الخزانة يحوي ملاحظات القوالب. لا تظهر ملاحظاته في قائمة مقالات المدونة. اتركه فارغًا ليُكتشف مجلد باسم Templates تلقائيًا.",
  },
  templatesDetectedHint: { en: "Found automatically: {folder}", ar: "اكتُشف تلقائيًا: {folder}" },
  defaultTemplateLabel: { en: "Template for new notes", ar: "قالب الملاحظات الجديدة" },
  defaultTemplateHint: {
    en: "Applied to every note created from here. Off by default — new notes are born empty.",
    ar: "يُطبَّق على كل ملاحظة تُنشأ من هنا. معطّل افتراضيًا — تُنشأ الملاحظات فارغة.",
  },
  templatePlaceholdersHint: {
    en: "Placeholders: {{date}}, {{time}}, {{title}}, {{Title}}, {{date:FORMAT}}, {{hdate}}. Anything else is left as written.",
    ar: "العناصر النائبة: {{date}} و{{time}} و{{title}} و{{Title}} و{{date:FORMAT}} و{{hdate}}. وما عداها يبقى كما كُتب.",
  },

  // ── Localization: calendar, note layout, tag labels ───────────────────────
  // Three features, one section, because they answer one question: what does
  // this instance look like to a reader who does not read English.

  // The note-layout broadcast. ONE set of words for two surfaces (the
  // properties card's chip and the status bar's segment), which is what stops
  // the two from drifting; they are deliberately SHORT, because both live in
  // a strip that is already competing for width.
  layoutDirection: { en: "Direction", ar: "الاتجاه" },
  layoutAlignment: { en: "Alignment", ar: "المحاذاة" },
  layoutDirAuto: { en: "Auto", ar: "تلقائي" },
  layoutDirLtr: { en: "LTR", ar: "يسارية" },
  layoutDirRtl: { en: "RTL", ar: "يمينية" },
  layoutAlignStart: { en: "Start", ar: "البداية" },
  layoutAlignLeft: { en: "Left", ar: "يسار" },
  layoutAlignRight: { en: "Right", ar: "يمين" },
  layoutAlignCenter: { en: "Centred", ar: "توسيط" },
  layoutAlignJustify: { en: "Justified", ar: "ضبط" },
  layoutSourceNote: { en: "set by this note", ar: "محدَّد في هذه الملاحظة" },
  layoutSourceSite: { en: "the site default", ar: "الإعداد الافتراضي للموقع" },
  layoutSegmentLabel: { en: "Text layout", ar: "تخطيط النص" },

  // Settings → Appearance & language: the calendar.
  groupCalendar: { en: "Calendar", ar: "التقويم" },
  rowDateCalendar: { en: "Date calendar", ar: "تقويم التواريخ" },
  hintDateCalendar: {
    en: "Which calendar every date a reader sees is printed in — post dates, comment timestamps, the backup badge. Hijri dates use Umm al-Qura, the calendar printed on the calendars people own.",
    ar: "التقويم الذي تُطبع به كل تواريخ الموقع الظاهرة للقارئ: تواريخ المقالات، وأوقات التعليقات، وشارة النسخ الاحتياطي. التواريخ الهجرية بحساب أم القرى، وهو التقويم المطبوع في الرزنامات المتداولة.",
  },
  calGregorian: { en: "Gregorian", ar: "ميلادي" },
  calHijri: { en: "Hijri", ar: "هجري" },
  calBoth: { en: "Both", ar: "كلاهما" },
  calSpecimen: { en: "Today reads", ar: "تاريخ اليوم" },
  calFeedNote: {
    en: "The RSS feed is unaffected: its XML keeps RFC-822 Gregorian dates, which is what an aggregator parses.",
    ar: "لا تتأثر خلاصة RSS: يبقى ملف XML بتواريخ ميلادية بصيغة RFC-822، وهي ما يقرأه القارئ الآلي.",
  },
  calArabicSuggest: {
    en: "This instance speaks Arabic, and many Arabic sites date their writing by the Hijri calendar. A suggestion, not a default — nothing changes until you pick it.",
    ar: "لغة هذا الموقع العربية، وكثير من المواقع العربية تؤرّخ كتاباتها بالتقويم الهجري. هذا اقتراح لا إعداد افتراضي: لا يتغيّر شيء حتى تختاره.",
  },

  // Settings → Appearance & language: note direction and alignment.
  groupNoteLayout: { en: "Note layout", ar: "تخطيط الملاحظات" },
  rowTextDirection: { en: "Text direction", ar: "اتجاه النص" },
  hintTextDirection: {
    en: "Base direction for note prose in the editor, the reading view and blog articles. Auto lets every paragraph decide from its own first letter, which is what a mixed vault wants.",
    ar: "الاتجاه الأساسي لنص الملاحظات في المحرر وعرض القراءة ومقالات المدونة. «تلقائي» يترك كل فقرة تقرر بحسب أول حرف فيها، وهو ما يناسب خزانة تجمع اللغتين.",
  },
  rowTextAlign: { en: "Text alignment", ar: "محاذاة النص" },
  hintTextAlign: {
    en: "Where lines sit inside the column. Code blocks, tables and display maths are never centred or justified, whatever this says.",
    ar: "موضع الأسطر داخل العمود. لا تُوسَّط كتل الشيفرة والجداول والمعادلات المعروضة ولا تُضبط مهما كان هذا الإعداد.",
  },
  noteLayoutOverride: {
    en: "Any note overrides both from its own frontmatter — dir: rtl, align: justify — and a note that does says so in its properties card and in the status bar.",
    ar: "تستطيع أي ملاحظة تجاوز الإعدادين من ترويستها — dir: rtl و align: justify — والملاحظة التي تفعل ذلك تعلنه في بطاقة خصائصها وفي شريط الحالة.",
  },

  // Settings → Appearance & language: localised tag labels.
  groupTagLabels: { en: "Tag labels", ar: "تسميات الوسوم" },
  tagLabelsNote: {
    en: "What a tag is CALLED on the front end. The vault keeps its own tags exactly as written: links, addresses, hidden tags and the language filter all go on matching the real value, search answers to both spellings, and no note is ever rewritten.",
    ar: "الاسم الذي يظهر به الوسم للقارئ. تبقى وسوم الخزانة كما كُتبت تمامًا: الروابط والعناوين والوسوم المخفية وتصفية اللغة كلها تطابق القيمة الأصلية، والبحث يستجيب للتهجئتين، ولا يُعاد كتابة أي ملاحظة.",
  },
  rowTagsFolder: { en: "Tags folder", ar: "مجلد الوسوم" },
  hintTagsFolder: {
    en: "Where a tag’s own page lives. A note there may carry a labels map in its frontmatter, and it outranks the table below — so the naming travels with the vault.",
    ar: "المجلد الذي تعيش فيه صفحة الوسم. يمكن لملاحظة فيه أن تحمل خريطة labels في ترويستها، وهي تتقدّم على الجدول أدناه — فتسافر التسمية مع الخزانة نفسها.",
  },
  /** The table's own row label. NOT the group heading it sits under — a row
   *  whose label repeats the heading two lines above it says nothing twice. */
  tagLabelsRowLabel: { en: "Labels", ar: "التسميات" },
  tagLabelsTag: { en: "Tag", ar: "الوسم" },
  tagLabelsEnglish: { en: "English", ar: "بالإنجليزية" },
  tagLabelsArabic: { en: "Arabic", ar: "بالعربية" },
  tagLabelsAdd: { en: "Add a tag", ar: "إضافة وسم" },
  tagLabelsRemove: { en: "Remove this label", ar: "حذف هذه التسمية" },
  tagLabelsEmpty: {
    en: "No labels yet. Add one to give a tag another name on the front end.",
    ar: "لا توجد تسميات بعد. أضف واحدة لتمنح وسمًا اسمًا آخر في الواجهة.",
  },
  tagLabelsTagPlaceholder: { en: "canonical tag", ar: "الوسم الأصلي" },
  tagLabelsLabelPlaceholder: { en: "shown instead", ar: "المعروض بدلًا منه" },
  tagLabelsPageWins: {
    en: "A tag with its own page in the tags folder is named there instead — this table is for the tags that have none.",
    ar: "الوسم الذي له صفحة في مجلد الوسوم يُسمّى هناك بدلًا من هنا — وهذا الجدول للوسوم التي لا صفحة لها.",
  },

  // ── Site design engine (client/design/) ─────────────────────────────────
  // The third public layout. Everything below is either the OWNER's copy (the
  // notices, which a visitor never sees — a broken design gives them the stock
  // blog and no explanation) or the designed site's own small chrome.
  layoutDesigned: { en: "Designed", ar: "مصمَّمة" },
  secHero: { en: "Hero", ar: "واجهة" },
  secRichText: { en: "Text", ar: "نص" },
  secNote: { en: "Note", ar: "ملاحظة" },
  secPostGrid: { en: "Post grid", ar: "شبكة مقالات" },
  secPostList: { en: "Post list", ar: "قائمة مقالات" },
  secTopics: { en: "Topics", ar: "موضوعات" },
  secCta: { en: "Call to action", ar: "دعوة للتفاعل" },
  secDivider: { en: "Divider", ar: "فاصل" },
  secConfig: { en: "Design settings", ar: "إعدادات التصميم" },
  secPage: { en: "Page", ar: "صفحة" },
  dsnReadMore: { en: "Read more", ar: "اقرأ المزيد" },
  dsnNoPosts: { en: "Nothing published here yet.", ar: "لا يوجد منشور هنا بعد." },
  dsnRelated: { en: "Related", ar: "ذات صلة" },
  dsnBrokenTitle: { en: "Design problem.", ar: "مشكلة في التصميم." },
  dsnFellBack: {
    en: "Your visitors are seeing the built-in blog.",
    ar: "يرى زوارك المدونة المدمجة.",
  },
  dsnSectionFailed: {
    en: "The {section} section ({id}) could not be rendered.",
    ar: "تعذّر عرض قسم {section} ({id}).",
  },
  dsnNoteMissing: {
    en: "It points at a note that is not there: {note}",
    ar: "يشير إلى ملاحظة غير موجودة: {note}",
  },
  dsnNoteUnavailable: {
    en: "It points at a note this reader may not see, so the page cannot be built for them.",
    ar: "يشير إلى ملاحظة لا يُسمح لهذا القارئ برؤيتها، فتعذّر بناء الصفحة له.",
  },
  dsnUnknownKind: { en: "This build does not know that section.", ar: "هذه النسخة لا تعرف ذلك القسم." },
  dsnUnknownKindDetail: {
    en: "This build does not know the section type “{kind}”.",
    ar: "هذه النسخة لا تعرف نوع القسم «{kind}».",
  },
  dsnConfigInvalid: { en: "The design is not valid: {detail}", ar: "التصميم غير صالح: {detail}" },
  dsnQuarantined: {
    en: "“{design}” is kept but not rendered — {detail}",
    ar: "«{design}» محفوظ لكنه غير معروض — {detail}",
  },
  dsnNoDesign: {
    en: "There is no design to render yet.",
    ar: "لا يوجد تصميم لعرضه بعد.",
  },
  dsnNoticeSection: {
    en: "A section points at a note that is not published: {detail}",
    ar: "أحد الأقسام يشير إلى ملاحظة غير منشورة: {detail}",
  },
  dsnRevertStock: { en: "Back to the stock blog", ar: "العودة إلى المدونة الأصلية" },
  dsnRevertedToast: {
    en: "Back on the stock blog. Your design is kept.",
    ar: "عدنا إلى المدونة الأصلية، وتصميمك محفوظ.",
  },
  dsnRevertFailed: { en: "Could not switch back.", ar: "تعذّرت العودة." },

  // ── Custom theme builder (client/components/ThemeBuilder.tsx) ────────────
  themeGroupCustom: { en: "Your themes", ar: "سماتك" },
  tbTitle: { en: "Custom theme", ar: "سمة مخصصة" },
  tbHint: {
    en: "Pick a base, then change only what you want. The app behind this panel is the preview.",
    ar: "اختر أساسًا ثم غيّر ما تريد فقط. التطبيق خلف هذه اللوحة هو المعاينة.",
  },
  tbNew: { en: "New custom theme", ar: "سمة مخصصة جديدة" },
  tbEdit: { en: "Edit this theme", ar: "تحرير هذه السمة" },
  tbName: { en: "Name", ar: "الاسم" },
  tbBase: { en: "Based on", ar: "مبنية على" },
  tbBasedOn: { en: "Based on {base}", ar: "مبنية على {base}" },
  tbGroup: { en: "Listed as", ar: "تُدرج ضمن" },
  tbTokens: { en: "Tokens", ar: "المتغيرات" },
  tbGroupGround: { en: "Grounds", ar: "الأرضيات" },
  tbGroupText: { en: "Text", ar: "النص" },
  tbGroupAccent: { en: "Accent", ar: "اللون المميز" },
  tbGroupLine: { en: "Borders", ar: "الحدود" },
  tbGroupCallout: { en: "Callouts", ar: "التنبيهات" },
  tbGroupCode: { en: "Code", ar: "الشيفرة" },
  tbGroupGraph: { en: "Graph", ar: "الرسم البياني" },
  tbSet: { en: "Set", ar: "معيَّن" },
  tbInherited: { en: "Base", ar: "الأساس" },
  tbResetToken: { en: "Use the base value", ar: "استخدام قيمة الأساس" },
  tbAllClear: {
    en: "Every contrast rule passes.",
    ar: "كل قواعد التباين مستوفاة.",
  },
  tbWarnRatio: {
    en: "{token} on {ground} is {value}:1 — the floor is {min}:1.",
    ar: "‏{token} على {ground} يساوي {value}:1 — الحد الأدنى {min}:1.",
  },
  tbWarnDeltaE: {
    en: "The accent is only {value} ΔE from the body text — it needs {min} to read as an accent at all.",
    ar: "اللون المميز يبعد {value} ΔE فقط عن نص المتن — يلزم {min} ليُقرأ كلون مميز أصلًا.",
  },
  tbNeedName: { en: "Give the theme a name.", ar: "أعطِ السمة اسمًا." },
  tbNotATheme: { en: "That file is not a Vellum theme.", ar: "هذا الملف ليس سمة ڤيلوم." },
  tbFull: {
    en: "This instance already holds {max} custom themes.",
    ar: "تحتوي هذه النسخة بالفعل على {max} سمة مخصصة.",
  },
  tbImport: { en: "Import…", ar: "استيراد…" },
  tbExport: { en: "Export", ar: "تصدير" },
  tbSaved: { en: "Saved “{name}”.", ar: "حُفظت «{name}»." },
  tbDeleted: { en: "Theme deleted.", ar: "حُذفت السمة." },
  tbDeleteTitle: { en: "Delete this theme?", ar: "حذف هذه السمة؟" },
  tbDeleteBody: {
    en: "“{name}” will be removed from the picker. Anything using it falls back to the theme it was built on.",
    ar: "ستُزال «{name}» من قائمة السمات، وسيعود كل ما يستخدمها إلى السمة المبنية عليها.",
  },

  // ── The site designer (designed mode) ────────────────────────────────────
  // The public site's own chrome first (a visitor can read these), then the
  // admin panel that builds it.
  designNavLabel: { en: "Site navigation", ar: "تنقل الموقع" },
  designMenu: { en: "Menu", ar: "القائمة" },
  designSecHeader: { en: "the header", ar: "الترويسة" },
  designSecFooter: { en: "the footer", ar: "التذييل" },
  designCorruptNotice: {
    en: "A design in this instance could not be read, so the stock site is being served.",
    ar: "تعذّرت قراءة أحد التصاميم في هذه النسخة، لذا يُقدَّم الموقع الأصلي.",
  },

  designTitle: { en: "Design your site", ar: "صمّم موقعك" },
  designPaletteHint: { en: "navigation, pages, type, header & footer", ar: "التنقل والصفحات والخط والترويسة والتذييل" },
  designPublicSite: { en: "Public site", ar: "الموقع العام" },
  designLayoutApp: { en: "App", ar: "التطبيق" },
  designLayoutBlog: { en: "Stock blog", ar: "المدونة الأصلية" },
  designLayoutDesign: { en: "Designed", ar: "المصمَّم" },
  designLayoutDesigned: { en: "Visitors now see your design.", ar: "أصبح الزوار يرون تصميمك." },
  designLayoutStock: { en: "Visitors now see the stock site.", ar: "أصبح الزوار يرون الموقع الأصلي." },
  designNotLiveNote: {
    en: "The public site is not on your design yet — switch it above when you are ready.",
    ar: "الموقع العام ليس على تصميمك بعد — بدّله بالأعلى عندما تجهز.",
  },
  designSections: { en: "Design sections", ar: "أقسام التصميم" },
  designLoading: { en: "Loading the design…", ar: "جارٍ تحميل التصميم…" },
  designLoadFailed: { en: "Could not load the design", ar: "تعذّر تحميل التصميم" },
  designSaved: { en: "Design saved", ar: "حُفظ التصميم" },
  designSaveFailed: { en: "Could not save the design", ar: "تعذّر حفظ التصميم" },
  designPreview: { en: "Live preview", ar: "معاينة حيّة" },
  designUnsaved: { en: "Unsaved changes", ar: "تغييرات غير محفوظة" },
  designAllSaved: { en: "Everything saved", ar: "كل شيء محفوظ" },
  designDiscard: { en: "Discard", ar: "تجاهل" },
  designSave: { en: "Save design", ar: "حفظ التصميم" },

  designTabNav: { en: "Navigation", ar: "التنقل" },
  designTabNavIntro: {
    en: "Build the menu by hand: pages, notes, topics and links, in the order you choose.",
    ar: "ابنِ القائمة بنفسك: صفحات وملاحظات وموضوعات وروابط، بالترتيب الذي تختاره.",
  },
  designTabPages: { en: "Pages", ar: "الصفحات" },
  designTabPagesIntro: {
    en: "Static pages are ordinary notes marked as pages — they leave the post feed and keep their own address.",
    ar: "الصفحات الثابتة ملاحظات عادية موسومة كصفحات — تخرج من تدفق المقالات وتحتفظ بعنوانها.",
  },
  designTabType: { en: "Typography", ar: "الطباعة" },
  designTabTypeIntro: {
    en: "Size, scale, measure and rhythm. Every control is bounded to values that stay readable.",
    ar: "الحجم والتدرّج وعرض السطر والإيقاع. كل عنصر محدود بقيم تبقى مقروءة.",
  },
  designTabChrome: { en: "Header & footer", ar: "الترويسة والتذييل" },
  designTabChromeIntro: {
    en: "Where the identity sits, what follows the reader down the page, and what the footer holds.",
    ar: "أين تقف هوية الموقع، وما الذي يتبع القارئ أثناء التمرير، وما الذي يحمله التذييل.",
  },
  designTabFile: { en: "Design file", ar: "ملف التصميم" },
  designTabFileIntro: {
    en: "Name this design, export it as JSON, import one, or reset to the stock defaults.",
    ar: "سمِّ هذا التصميم، أو صدّره بصيغة JSON، أو استورد آخر، أو أعِد الضبط الأصلي.",
  },

  designNavEmpty: {
    en: "No menu items yet — the site falls back to your busiest topics.",
    ar: "لا عناصر في القائمة بعد — يعود الموقع إلى أكثر موضوعاتك تكرارًا.",
  },
  designAddItem: { en: "Add", ar: "إضافة" },
  designNewItem: { en: "New item", ar: "عنصر جديد" },
  designHomeLabel: { en: "Home", ar: "الرئيسية" },
  designGroupLabel: { en: "Group", ar: "مجموعة" },
  designKindHome: { en: "Home", ar: "الرئيسية" },
  designKindNote: { en: "Note", ar: "ملاحظة" },
  designKindPage: { en: "Page", ar: "صفحة" },
  designKindTopic: { en: "Topic", ar: "موضوع" },
  designKindUrl: { en: "Link", ar: "رابط" },
  designKindGroup: { en: "Submenu", ar: "قائمة فرعية" },
  designMoveUp: { en: "Move up", ar: "تحريك لأعلى" },
  designMoveDown: { en: "Move down", ar: "تحريك لأسفل" },
  designNest: { en: "Nest under the item above", ar: "إدراج ضمن العنصر أعلاه" },
  designUnnest: { en: "Lift out of the submenu", ar: "إخراج من القائمة الفرعية" },
  designHideItem: { en: "Hide from the site", ar: "إخفاء من الموقع" },
  designShowItem: { en: "Show on the site", ar: "إظهار في الموقع" },
  designRemoveItem: { en: "Remove", ar: "حذف" },
  designItemLabel: { en: "Label", ar: "التسمية" },
  designPickNote: { en: "Note", ar: "الملاحظة" },
  designPickPage: { en: "Page", ar: "الصفحة" },
  designPickTopic: { en: "Topic", ar: "الموضوع" },
  designFilterNotes: { en: "Filter notes…", ar: "تصفية الملاحظات…" },
  designFilterTopics: { en: "Filter topics…", ar: "تصفية الموضوعات…" },
  designUrl: { en: "URL", ar: "الرابط" },
  designNewTab: { en: "Open in a new tab", ar: "فتح في تبويب جديد" },
  designItemUnpublished: {
    en: "Not visible to readers yet — publish this note and it appears.",
    ar: "غير ظاهر للقراء بعد — انشر هذه الملاحظة ليظهر.",
  },
  designItemBadUrl: {
    en: "Needs an https:// address or a site path starting with /",
    ar: "يحتاج عنوان ‎https://‎ أو مسارًا داخل الموقع يبدأ بـ ‎/‎",
  },
  designItemHidden: { en: "Hidden — kept here, not shown on the site", ar: "مخفي — محفوظ هنا، وغير معروض في الموقع" },
  designNavFallback: { en: "When the menu is empty", ar: "عندما تكون القائمة فارغة" },
  designNavFallbackHint: {
    en: "The stock rule: your busiest published topics.",
    ar: "القاعدة الأصلية: أكثر موضوعاتك المنشورة تكرارًا.",
  },
  designFallbackTopics: { en: "Show topics", ar: "إظهار الموضوعات" },
  designFallbackNone: { en: "Show nothing", ar: "بلا شيء" },
  designShowSearch: { en: "Search box", ar: "مربع البحث" },
  designShowTheme: { en: "Theme switch", ar: "مبدّل السمة" },
  designShowLang: { en: "Language switch", ar: "مبدّل اللغة" },
  designShowLangHint: {
    en: "Only where the instance offers one.",
    ar: "فقط حيث تتيحه هذه النسخة.",
  },

  designPagesHow: {
    en: "A page is an ordinary note whose frontmatter carries both flags:",
    ar: "الصفحة ملاحظة عادية تحمل مقدمتها العَلَمين معًا:",
  },
  designPagesEffect: {
    en: "It then leaves the post feed and RSS, keeps its own clean address, and can be added to the menu above.",
    ar: "عندها تخرج من تدفق المقالات ومن RSS، وتحتفظ بعنوانها النظيف، ويمكن إضافتها إلى القائمة أعلاه.",
  },
  designNoPages: { en: "No pages yet.", ar: "لا صفحات بعد." },
  designPagesCount: { en: "{n} published pages.", ar: "{n} صفحة منشورة." },

  designTypeBase: { en: "Body size", ar: "حجم النص" },
  designTypeScale: { en: "Heading scale", ar: "تدرّج العناوين" },
  designTypeMeasure: { en: "Line length", ar: "طول السطر" },
  designTypeLine: { en: "Line height", ar: "ارتفاع السطر" },
  designTypeWeight: { en: "Heading weight", ar: "ثِخَن العناوين" },
  designTypeRhythm: { en: "Section rhythm", ar: "إيقاع الأقسام" },
  designHeadingCase: { en: "Heading case", ar: "حالة أحرف العناوين" },
  designCaseNormal: { en: "Normal", ar: "عادية" },
  designCaseSmall: { en: "Small caps", ar: "كبيرة صغيرة" },
  designCaseUpper: { en: "Uppercase", ar: "كبيرة" },
  designHeadingFamily: { en: "Heading face", ar: "خط العناوين" },
  designBodyFamily: { en: "Body face", ar: "خط النص" },
  designFamilyHint: {
    en: "Which of the instance's two stacks — pick the faces themselves in Settings → Typography.",
    ar: "أي مجموعتَي الخطوط في هذه النسخة — واختر الخطوط نفسها من الإعدادات ← الطباعة.",
  },
  designSerif: { en: "Serif", ar: "مذيّل" },
  designSans: { en: "Sans", ar: "غير مذيّل" },
  designBoundsNote: {
    en: "Every slider stops where legibility does: no size, measure or line height here can produce a site a reader cannot read.",
    ar: "كل شريط يتوقف حيث تتوقف المقروئية: لا حجم ولا طول سطر ولا ارتفاع سطر هنا ينتج موقعًا يعجز القارئ عن قراءته.",
  },

  designHeaderSection: { en: "Header", ar: "الترويسة" },
  designHeaderLayout: { en: "Identity", ar: "الهوية" },
  designLayoutStacked: { en: "Centred", ar: "في الوسط" },
  designLayoutStart: { en: "Aligned", ar: "على الحافة" },
  designLayoutInline: { en: "One row", ar: "صف واحد" },
  designHeaderDensity: { en: "Height", ar: "الارتفاع" },
  designDensityCompact: { en: "Compact", ar: "مضغوط" },
  designDensityRegular: { en: "Regular", ar: "عادي" },
  designDensityTall: { en: "Tall", ar: "مرتفع" },
  designSticky: { en: "Follows the reader", ar: "يتبع القارئ" },
  designStickyHint: {
    en: "What stays on screen while the page scrolls.",
    ar: "ما الذي يبقى على الشاشة أثناء تمرير الصفحة.",
  },
  designStickyNone: { en: "Nothing", ar: "لا شيء" },
  designStickyNav: { en: "The menu", ar: "القائمة" },
  designStickyHeader: { en: "The header", ar: "الترويسة" },
  designShowLogo: { en: "Logo", ar: "الشعار" },
  designShowLogoHint: {
    en: "Uses the logo set in Settings → Site identity.",
    ar: "يستخدم الشعار المضبوط في الإعدادات ← هوية الموقع.",
  },
  designShowName: { en: "Site name", ar: "اسم الموقع" },
  designShowTagline: { en: "Tagline", ar: "الوصف" },
  designDivider: { en: "Hairline under the header", ar: "خط رفيع تحت الترويسة" },

  designFooterSection: { en: "Footer", ar: "التذييل" },
  designFooterEmpty: { en: "No columns yet.", ar: "لا أعمدة بعد." },
  designColumn: { en: "Column", ar: "عمود" },
  designColumnTitle: { en: "Column heading", ar: "عنوان العمود" },
  designRemoveColumn: { en: "Remove column", ar: "حذف العمود" },
  designAddColumn: { en: "Add a column", ar: "إضافة عمود" },
  designAddEntry: { en: "Add", ar: "إضافة" },
  designEntryLink: { en: "Link", ar: "رابط" },
  designEntryText: { en: "Text", ar: "نص" },
  designEntrySocial: { en: "Social", ar: "حساب" },
  designNetwork: { en: "Network", ar: "الشبكة" },
  designCopyright: { en: "Copyright line", ar: "سطر الحقوق" },
  designCopyrightHint: {
    en: "{year} and {siteName} are filled in. Empty keeps the instance's own footer line.",
    ar: "يُملأ {year} و{siteName} تلقائيًا. وتركه فارغًا يُبقي سطر التذييل الخاص بالنسخة.",
  },
  designShowCopyright: { en: "Show the copyright line", ar: "إظهار سطر الحقوق" },
  designFooterAlign: { en: "Alignment", ar: "المحاذاة" },
  designAlignStart: { en: "Leading edge", ar: "حافة البداية" },
  designAlignCenter: { en: "Centred", ar: "في الوسط" },
  designShowRss: { en: "RSS link", ar: "رابط RSS" },
  designShowHint: { en: "Search hint", ar: "تلميح البحث" },
  designShowPowered: { en: "Powered-by line", ar: "سطر «مدعوم بـ»" },

  designName: { en: "Design name", ar: "اسم التصميم" },
  designNameHint: {
    en: "Travels with the exported file — how you will recognise it later.",
    ar: "يرافق الملف المصدَّر — وبه تتعرف عليه لاحقًا.",
  },
  designUnnamed: { en: "Unnamed design", ar: "تصميم بلا اسم" },
  designExport: { en: "Export JSON", ar: "تصدير JSON" },
  designImport: { en: "Import JSON", ar: "استيراد JSON" },
  designImported: { en: "Design imported", ar: "تم استيراد التصميم" },
  designImportFailed: { en: "That file is not a valid design", ar: "هذا الملف ليس تصميمًا صالحًا" },
  designReset: { en: "Reset to stock", ar: "إعادة الضبط الأصلي" },
  designResetTitle: { en: "Reset the design?", ar: "إعادة ضبط التصميم؟" },
  designResetBody: {
    en: "Every design choice returns to the stock defaults. The public site itself is not switched.",
    ar: "تعود كل خيارات التصميم إلى الضبط الأصلي. أما الموقع العام نفسه فلا يُبدَّل.",
  },
  designResetConfirm: { en: "Reset the design", ar: "إعادة الضبط" },
  designFileNote: {
    en: "The design is kept even while the public site is on the stock blog, so switching between them loses nothing.",
    ar: "يُحفظ التصميم حتى بينما يعمل الموقع العام بالمدونة الأصلية، فالتبديل بينهما لا يفقد شيئًا.",
  },

  designSampleTopic: { en: "Topics", ar: "موضوعات" },
  designSpecimenTitle: { en: "A page of your site", ar: "صفحة من موقعك" },
  designSpecimenLead: {
    en: "This is how your prose will read: the size, the measure, the line height and the rhythm between blocks, all at once.",
    ar: "هكذا سيُقرأ نصك: الحجم وطول السطر وارتفاعه والإيقاع بين الكتل، كلها معًا.",
  },
  designSpecimenH2: { en: "A second-level heading", ar: "عنوان من المستوى الثاني" },
  designSpecimenH3: { en: "A third-level heading", ar: "عنوان من المستوى الثالث" },
  designSpecimenBody: {
    en: "Headings step by the scale you chose, so the hierarchy holds at every size — an h3 can never outgrow the h2 above it.",
    ar: "تتدرّج العناوين بالنسبة التي اخترتها، فيثبت التسلسل عند كل حجم — ولا يمكن لعنوان ثالث أن يتجاوز الثاني فوقه.",
  },

  // ── The composer: the design store, the section list, the field editors ──
  // B2's reorderable list and B1's eight section kinds meet here. The `dsn*`
  // rows are the LIST's own controls (each names the row it acts on, because
  // "Move up" alone is nine identical buttons to a screen reader); the `dso*`
  // rows are the per-section fields.
  dsnMoveUp: { en: "Move up", ar: "نقل لأعلى" },
  dsnMoveDown: { en: "Move down", ar: "نقل لأسفل" },
  dsnMoveUpOf: { en: "Move {name} up", ar: "نقل {name} لأعلى" },
  dsnMoveDownOf: { en: "Move {name} down", ar: "نقل {name} لأسفل" },
  dsnShowOf: { en: "Show {name}", ar: "إظهار {name}" },
  dsnRemove: { en: "Remove", ar: "إزالة" },
  dsnRemoveOf: { en: "Remove {name}", ar: "إزالة {name}" },
  dsnShown: { en: "Shown", ar: "ظاهر" },
  dsnHidden: { en: "Hidden", ar: "مخفي" },
  dsnAlwaysShown: { en: "always shown", ar: "يظهر دائمًا" },

  designTabDesigns: { en: "Designs", ar: "التصاميم" },
  designTabDesignsIntro: {
    en: "Every design this instance holds. One is active; switching between them changes nothing on disk, so a design you turn off is a design you can turn back on unchanged.",
    ar: "كل التصاميم في هذه النسخة. واحد منها نشط، والتبديل بينها لا يغيّر شيئًا على القرص — فالتصميم الذي توقفه يمكنك إعادته كما كان تمامًا.",
  },
  designTabSections: { en: "Sections", ar: "الأقسام" },
  designTabSectionsIntro: {
    en: "What the home page is made of, top to bottom. Drag a row, or move it with the arrows; open one to edit what it shows.",
    ar: "مما تتكوّن الصفحة الرئيسية، من أعلاها إلى أسفلها. اسحب صفًا أو حرّكه بالأسهم، وافتح أحدها لتحرير ما يعرضه.",
  },
  designNew: { en: "New design", ar: "تصميم جديد" },
  designNewTitle: { en: "New design", ar: "تصميم جديد" },
  designCreate: { en: "Create", ar: "إنشاء" },
  designCreated: { en: "Design created.", ar: "أُنشئ التصميم." },
  designActive: { en: "Active", ar: "نشط" },
  designActivate: { en: "Make active", ar: "تفعيل" },
  designActivated: { en: "Design activated.", ar: "فُعِّل التصميم." },
  designDuplicate: { en: "Duplicate", ar: "تكرار" },
  designDuplicated: { en: "Design duplicated.", ar: "كُرِّر التصميم." },
  designDeleted: { en: "Design deleted.", ar: "حُذف التصميم." },
  designDeleteTitle: { en: "Delete this design?", ar: "حذف هذا التصميم؟" },
  designDeleteBody: {
    en: "“{name}” will be removed from this instance. The stock blog is unaffected either way.",
    ar: "ستُزال «{name}» من هذه النسخة. المدوّنة الأصلية لا تتأثر في الحالتين.",
  },
  designNoneYet: {
    en: "No design yet. Make one — until you do, the public site is the stock blog.",
    ar: "لا يوجد تصميم بعد. أنشئ واحدًا — وإلى أن تفعل، يبقى الموقع العام هو المدوّنة الأصلية.",
  },
  designOpenSection: { en: "The design you are editing", ar: "التصميم الذي تحرّره" },
  designTheme: { en: "Theme", ar: "السمة" },
  designThemeHint: {
    en: "Forced on readers who have not chosen one of their own. A design is a look, and a look is a theme plus a layout.",
    ar: "تُفرض على القرّاء الذين لم يختاروا سمة بأنفسهم. التصميم مظهر، والمظهر سمة وتخطيط معًا.",
  },
  designThemeInherit: { en: "Site default", ar: "افتراضي الموقع" },

  dsoHintHero: { en: "A big opening block", ar: "كتلة افتتاحية كبيرة" },
  dsoHintRichText: { en: "Your own markdown", ar: "نصّك بصيغة ماركداون" },
  dsoHintNote: { en: "One note from the vault", ar: "ملاحظة واحدة من الخزانة" },
  dsoHintPostGrid: { en: "Posts as cards", ar: "المقالات كبطاقات" },
  dsoHintPostList: { en: "Posts as a list", ar: "المقالات كقائمة" },
  dsoHintTopics: { en: "The tags you write about", ar: "الوسوم التي تكتب فيها" },
  dsoHintCta: { en: "A line and a button", ar: "سطر وزِر" },
  dsoHintDivider: { en: "A rule, dots, or air", ar: "خط أو نقاط أو فراغ" },

  dsoHeading: { en: "Heading", ar: "العنوان" },
  dsoHeadingHint: { en: "Leave empty for none", ar: "اتركه فارغًا لإخفائه" },
  dsoNoHeading: { en: "no heading", ar: "بلا عنوان" },
  dsoHeroHeadingHint: { en: "Empty uses the site name", ar: "الفارغ يستخدم اسم الموقع" },
  dsoHeroSiteName: { en: "the site name", ar: "اسم الموقع" },
  dsoSub: { en: "Subtitle", ar: "العنوان الفرعي" },
  dsoImage: { en: "Image", ar: "صورة" },
  dsoImageHint: { en: "An https URL or a vault path", ar: "رابط https أو مسار داخل الخزانة" },
  dsoAlign: { en: "Alignment", ar: "المحاذاة" },
  dsoAlignStart: { en: "Start", ar: "البداية" },
  dsoAlignCenter: { en: "Centre", ar: "الوسط" },
  dsoHeight: { en: "Height", ar: "الارتفاع" },
  dsoHeightShort: { en: "Short", ar: "قصير" },
  dsoHeightTall: { en: "Tall", ar: "مرتفع" },
  dsoMarkdown: { en: "Markdown", ar: "ماركداون" },
  dsoMarkdownHint: {
    en: "Rendered by the same renderer a note is — wikilinks, callouts and all.",
    ar: "يُعرض بالمحرّك نفسه الذي يعرض الملاحظات — بروابط الويكي والتنبيهات وكل شيء.",
  },
  dsoNote: { en: "Note", ar: "الملاحظة" },
  dsoNoteHint: {
    en: "A note that is later deleted or unpublished drops visitors to the stock blog and tells you which section.",
    ar: "الملاحظة التي تُحذف أو يُلغى نشرها لاحقًا تُعيد الزوّار إلى المدوّنة الأصلية وتخبرك بالقسم المسؤول.",
  },
  dsoFilterNotes: { en: "Filter notes…", ar: "تصفية الملاحظات…" },
  dsoFilterTags: { en: "Filter tags…", ar: "تصفية الوسوم…" },
  dsoExcerpt: { en: "First paragraph only", ar: "الفقرة الأولى فقط" },
  dsoExcerptHint: { en: "With a link through to the note", ar: "مع رابط إلى الملاحظة" },
  dsoTag: { en: "Tag", ar: "الوسم" },
  dsoAllPosts: { en: "Every post", ar: "كل المقالات" },
  dsoLimit: { en: "How many", ar: "كم" },
  dsoPosts: { en: "posts", ar: "مقالة" },
  dsoTopics: { en: "topics", ar: "موضوعًا" },
  dsoColumns: { en: "Columns", ar: "الأعمدة" },
  dsoShowBanner: { en: "Banners", ar: "اللافتات" },
  dsoShowExcerpt: { en: "Excerpts", ar: "المقتطفات" },
  dsoShowDate: { en: "Dates", ar: "التواريخ" },
  dsoBody: { en: "Body", ar: "النص" },
  dsoButton: { en: "Button", ar: "الزر" },
  dsoUrl: { en: "Link", ar: "الرابط" },
  dsoUrlHint: { en: "A site path like /topic/essays, or an https URL", ar: "مسار داخل الموقع مثل ‎/topic/essays‎ أو رابط https" },
  dsoStyle: { en: "Style", ar: "النمط" },
  dsoStyleRule: { en: "Rule", ar: "خط" },
  dsoStyleDots: { en: "Dots", ar: "نقاط" },
  dsoStyleBlank: { en: "Air", ar: "فراغ" },
  dsoSpace: { en: "Space", ar: "المسافة" },
  dsoOn: { en: "On", ar: "مفعّل" },
  dsoOff: { en: "Off", ar: "معطّل" },

  dsnCorruptStore: {
    en: "designs.json could not be read, so visitors are getting the stock blog. The file is untouched — repair it, or import a design over it.",
    ar: "تعذّرت قراءة designs.json، لذا يحصل الزوّار على المدوّنة الأصلية. الملف لم يُمَس — أصلحه أو استورد تصميمًا فوقه.",
  },
  dsoAddSection: { en: "Add a section", ar: "إضافة قسم" },
  dsoPageSection: { en: "The page", ar: "الصفحة" },
  dsoWidth: { en: "Column width", ar: "عرض العمود" },
  dsoWidthHint: { en: "How wide the composed page runs", ar: "كم يتّسع عرض الصفحة المركّبة" },
  dsoDensity: { en: "Density", ar: "الكثافة" },
  dsoCompact: { en: "Compact", ar: "مضغوطة" },
  dsoRegular: { en: "Regular", ar: "معتادة" },
  dsoRoomy: { en: "Roomy", ar: "فسيحة" },
  dsoArticleSection: { en: "Article pages", ar: "صفحات المقالات" },
  dsoArtBanner: { en: "Banner", ar: "اللافتة" },
  dsoArtMeta: { en: "Date and reading time", ar: "التاريخ ووقت القراءة" },
  dsoArtTags: { en: "Tags", ar: "الوسوم" },
  dsoArtRelated: { en: "Related posts", ar: "مقالات ذات صلة" },
  dsoArtBack: { en: "Back link", ar: "رابط العودة" },
} satisfies Record<string, Entry>;

export type I18nKey = keyof typeof DICT;

/** The chrome string for `key` in the active language. */
export function t(key: I18nKey): string {
  return DICT[key][current];
}

// ── Locale numerals ─────────────────────────────────────────────────────────
// One numeral policy for every NUMBER the instance renders — blog post dates,
// moderation-row dates, marginalia timestamps AND every count beside them.
// Which digits plain "ar" resolves to is an ICU-version detail (some builds
// answer latn, others arab), so an Arabic site would otherwise print
// "15 أغسطس" in one place and "١٥ أغسطس" in the next. Eastern Arabic numerals
// are the intent: name them. An admin who spells a numbering system out
// (`ar-EG-u-nu-latn`) keeps exactly what they asked for — and the counts
// follow that choice too, because both read shared/numerals.ts.
export { arabicDefaultDigits, localeDigits } from "../shared/numerals.ts";

// ── Per-string direction ────────────────────────────────────────────────────
// Note-derived text (titles, tree labels, snippets) renders in ITS OWN
// direction, not the chrome's. In the DOM that is `dir="auto"`; on a <canvas>
// there is no such attribute, so the graphs ask this for `ctx.direction`.
// Same rule the HTML attribute uses: the first strong character wins, and a
// string with no strong character falls back to the chrome language.

// The explicit marks count too: `dir="auto"` treats U+200F RIGHT-TO-LEFT MARK
// (and U+200E LEFT-TO-RIGHT MARK) as strong characters of their direction, so
// a canvas label that opens with an RLM must resolve rtl exactly as the same
// string does in the DOM — this is the one place the two rules have to agree.
// U+061C (ALM) already falls inside the Arabic range. The Arabic-presentation
// range stops at U+FEFC: U+FEFF is the BOM (bidi class BN), not strong.
const RTL_STRONG = /[\u0591-\u07FF\u0860-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC\u200F]/u;
const LTR_STRONG = /[A-Za-z\u00C0-\u058F\u0900-\u1FFF\u2C00-\uD7FF\uF900-\uFB17\u200E]/u;

/** The direction `text` would get under `dir="auto"`. */
export function autoDir(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) return "rtl";
    if (LTR_STRONG.test(ch)) return "ltr";
  }
  return current === "ar" ? "rtl" : "ltr";
}

// Substituted values are almost always note-derived (a path, a title, a tag)
// and therefore of unknown direction: spliced raw into an Arabic sentence, a
// Latin path reorders against the words around it and a path containing an
// explicit bidi override (U+202E) can reshuffle the whole sentence — worst of
// all in the delete confirmation, where the reader must be able to tell which
// folder holds which note. FSI…PDI (the isolate the `dir="auto"` attribute
// applies in the DOM) resolves each value's direction on its own and keeps it
// from leaking into the sentence. Invisible in every renderer.
const FSI = "⁨";
const PDI = "⁩";

/** Isolate a value spliced into a sentence (first-strong direction, no leak). */
export function isolate(value: string | number): string {
  return `${FSI}${String(value)}${PDI}`;
}

/** t() with `{name}` placeholder substitution; every value bidi-isolated. */
export function tf(key: I18nKey, vars: Record<string, string | number>): string {
  let out = t(key);
  for (const [name, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, isolate(value));
  }
  return out;
}

// ── Count phrases ───────────────────────────────────────────────────────────
// Arabic agreement needs real plural forms (1 / 2 / 3–10 / 11+); English just
// needs an s. The digits come from localeNum(), i.e. the SAME numbering system
// the dates use — a card that reads "٩ يناير ٢٠٢٦" must not finish with
// "3 دقائق قراءة".

type CountUnit =
  | "notes"
  | "files"
  | "publishedNotes"
  | "links"
  | "words"
  | "chars"
  | "comments"
  | "marginNotes"
  | "foldedLines"
  | "readMinutes";

const UNITS: Record<CountUnit, { en: [string, string]; ar: { one: string; two: string; few: string; many: string } }> = {
  notes: { en: ["note", "notes"], ar: { one: "ملاحظة واحدة", two: "ملاحظتان", few: "ملاحظات", many: "ملاحظة" } },
  // The sidebar footer counts the vault's ATTACHMENTS beside its notes — the
  // images, PDFs and recordings that are not notes but are certainly files.
  files: { en: ["file", "files"], ar: { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفًا" } },
  // The visitor graph HUD counts published notes specifically.
  publishedNotes: {
    en: ["published note", "published notes"],
    ar: { one: "ملاحظة منشورة واحدة", two: "ملاحظتان منشورتان", few: "ملاحظات منشورة", many: "ملاحظة منشورة" },
  },
  links: { en: ["link", "links"], ar: { one: "رابط واحد", two: "رابطان", few: "روابط", many: "رابطًا" } },
  words: { en: ["word", "words"], ar: { one: "كلمة واحدة", two: "كلمتان", few: "كلمات", many: "كلمة" } },
  chars: { en: ["char", "chars"], ar: { one: "حرف واحد", two: "حرفان", few: "أحرف", many: "حرفًا" } },
  comments: { en: ["comment", "comments"], ar: { one: "تعليق واحد", two: "تعليقان", few: "تعليقات", many: "تعليقًا" } },
  // Marginalia counts its own entries "notes" (margin notes = حواشٍ), which is
  // a different word from a vault note (ملاحظة) — hence its own unit.
  marginNotes: { en: ["note", "notes"], ar: { one: "حاشية واحدة", two: "حاشيتان", few: "حواشٍ", many: "حاشية" } },
  // The editor's folded-section chip ("12 folded lines" / "١٢ سطرا مطويا").
  foldedLines: {
    en: ["folded line", "folded lines"],
    ar: { one: "سطر مطوي واحد", two: "سطران مطويان", few: "أسطر مطوية", many: "سطرًا مطويًا" },
  },
  // "min read" does not inflect in English; Arabic does, and the "قراءة" rides
  // along inside each form so the dual reads as a proper construct
  // ("دقيقتا قراءة"), not a number glued to a singular.
  readMinutes: {
    en: ["min read", "min read"],
    ar: { one: "دقيقة قراءة", two: "دقيقتا قراءة", few: "دقائق قراءة", many: "دقيقة قراءة" },
  },
};

/** "3 notes" / "3 ملاحظات" — a number with its correctly-agreed unit. */
export function countPhrase(n: number, unit: CountUnit): string {
  const forms = UNITS[unit];
  const num = localeNum(n);
  if (current === "en") return `${num} ${n === 1 ? forms.en[0] : forms.en[1]}`;
  const ar = forms.ar;
  if (n === 1) return ar.one;
  if (n === 2) return ar.two;
  if (n === 0) return `لا ${ar.few}`;
  if (n >= 3 && n <= 10) return `${num} ${ar.few}`;
  return `${num} ${ar.many}`;
}

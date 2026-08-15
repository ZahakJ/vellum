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
  newNotePrompt: { en: "New note name:", ar: "اسم الملاحظة الجديدة:" },
  newFolderPrompt: { en: "New folder name:", ar: "اسم المجلد الجديد:" },
  newNoteHere: { en: "New note here", ar: "ملاحظة جديدة هنا" },
  rename: { en: "Rename", ar: "إعادة تسمية" },
  delete: { en: "Delete", ar: "حذف" },
  deleteNoteTitle: { en: "Delete note?", ar: "حذف الملاحظة؟" },
  deleteNoteBody: {
    en: "“{path}” will be deleted. This cannot be undone.",
    ar: "سيُحذف “{path}” نهائيًا. لا يمكن التراجع عن هذا.",
  },
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
  viewPublicSite: { en: "View public site", ar: "عرض الموقع العام" },
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
  siteSettings: { en: "Site settings", ar: "إعدادات الموقع" },
  siteSettingsTitle: {
    en: "Site settings — identity, home page, behavior",
    ar: "إعدادات الموقع — الهوية والصفحة الرئيسية والسلوك",
  },
  previewAsVisitor: { en: "Preview as visitor", ar: "معاينة كزائر" },
  previewAsVisitorTitle: {
    en: "Preview as visitor — see exactly what the public site serves",
    ar: "معاينة كزائر — شاهد الموقع تمامًا كما يظهر للزوار",
  },
  read: { en: "read", ar: "قراءة" },
  readTitle: { en: "Toggle reading view (Ctrl/Cmd+E)", ar: "تبديل وضع القراءة (Ctrl/Cmd+E)" },
  vimTitle: { en: "Toggle vim keybindings", ar: "تبديل اختصارات vim" },
  themeTitle: { en: "Theme: {theme} — click for {next}", ar: "السمة: {theme} — انقر للتبديل إلى {next}" },
  cycleTheme: { en: "Cycle theme", ar: "تبديل السمة" },
  graph: { en: "graph", ar: "مخطط" },
  graphTitle: { en: "Toggle graph view (Ctrl/Cmd+G)", ar: "تبديل عرض المخطط (Ctrl/Cmd+G)" },
  signIn: { en: "Sign in", ar: "تسجيل الدخول" },
  signInTitle: { en: "Sign in to edit this vault", ar: "تسجيل الدخول لتحرير هذه الخزانة" },
  signOut: { en: "Sign out", ar: "تسجيل الخروج" },
  signOutTitle: { en: "Sign out — back to the visitor view", ar: "تسجيل الخروج — العودة إلى واجهة الزائر" },

  // ── Right panel ─────────────────────────────────────────────────────────
  backlinks: { en: "Backlinks", ar: "روابط راجعة" },
  showBacklinks: {
    en: "Show backlinks (Ctrl/Cmd+Shift+B)",
    ar: "إظهار الروابط الراجعة (Ctrl/Cmd+Shift+B)",
  },
  hideBacklinks: {
    en: "Hide backlinks (Ctrl/Cmd+Shift+B)",
    ar: "إخفاء الروابط الراجعة (Ctrl/Cmd+Shift+B)",
  },
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
  cmdTheme: { en: "Theme: {t}", ar: "السمة: {t}" },
  cmdAppearanceHint: { en: "appearance", ar: "المظهر" },
  cmdToggleVim: { en: "Toggle vim", ar: "تبديل vim" },
  cmdEditorHint: { en: "editor", ar: "المحرر" },
  // The sidebar-side command names a PHYSICAL edge, in both languages: an
  // Arabic reader moving the sidebar left is asking for the left of the
  // screen, not for "the trailing side".
  cmdSidebarRight: { en: "Move sidebar to the right", ar: "نقل الشريط الجانبي إلى اليمين" },
  cmdSidebarLeft: { en: "Move sidebar to the left", ar: "نقل الشريط الجانبي إلى اليسار" },
  cmdLayoutHint: { en: "layout", ar: "التخطيط" },
  cmdToggleSidebar: { en: "Toggle sidebar", ar: "طي الشريط الجانبي" },
  cmdTogglePanel: { en: "Toggle backlinks panel", ar: "طي لوحة الروابط الراجعة" },
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
  cmdIrreversibleHint: { en: "irreversible", ar: "لا رجعة فيه" },
  cmdModerateComments: { en: "Moderate comments", ar: "الإشراف على التعليقات" },
  cmdMarginaliaHint: { en: "marginalia", ar: "الحواشي" },
  cmdSiteSettingsHint: { en: "identity · home · behavior", ar: "الهوية · الرئيسية · السلوك" },
  cmdPreviewHint: { en: "see the public site", ar: "شاهد الموقع العام" },
  cmdExitPreview: { en: "Exit visitor preview", ar: "إنهاء معاينة الزائر" },
  cmdExitPreviewHint: { en: "back to the vault", ar: "العودة إلى الخزانة" },
  cmdSignInHint: { en: "unlock editing", ar: "فتح التحرير" },
  cmdSignOutHint: { en: "back to reading", ar: "العودة إلى القراءة" },
  couldNotCreateNote: { en: "Could not create note", ar: "تعذر إنشاء الملاحظة" },
  couldNotRenameNote: { en: "Could not rename note", ar: "تعذرت إعادة تسمية الملاحظة" },
  couldNotDeleteNote: { en: "Could not delete note", ar: "تعذر حذف الملاحظة" },

  // ── Confirm / login modals ──────────────────────────────────────────────
  cancel: { en: "Cancel", ar: "إلغاء" },
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
  groupIdentity: { en: "Identity", ar: "الهوية" },
  groupHome: { en: "Home page", ar: "الصفحة الرئيسية" },
  groupBehavior: { en: "Site behavior", ar: "سلوك الموقع" },
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
  errMdPath: { en: "must be a vault .md path", ar: "يجب أن يكون مسار ‎.md‎ داخل الخزانة" },
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
  openSidebar: { en: "Open sidebar", ar: "فتح الشريط الجانبي" },
  closeSidebar: { en: "Close sidebar", ar: "إغلاق الشريط الجانبي" },
  showSidebar: { en: "Show sidebar (Ctrl/Cmd+B)", ar: "إظهار الشريط الجانبي (Ctrl/Cmd+B)" },
  exitZen: { en: "Exit zen mode (Esc)", ar: "إنهاء وضع التركيز (Esc)" },
  // The one keystroke zen advertises on screen — the ✕ beside it is the mouse
  // route, this is the one that works when the chrome has faded.
  zenEscHint: { en: "Esc", ar: "مفتاح Esc" },
  noteGone: { en: "That note does not exist (anymore)", ar: "هذه الملاحظة لم تعد موجودة" },
  changedOnDisk: {
    en: "{path} changed on disk — your unsaved edits were kept",
    ar: "تغيرت {path} على القرص — احتفظنا بتعديلاتك غير المحفوظة",
  },
  newNotePathPrompt: {
    en: "New note path (e.g. ideas/Untitled.md):",
    ar: "مسار الملاحظة الجديدة (مثال: ‎ideas/Untitled.md‎):",
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

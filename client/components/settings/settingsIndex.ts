// THE SETTINGS INDEX — what a search across the panel matches against.
//
// GENERATED from the panel's own source by `node scripts/gen-settings-index.mjs`,
// and held there by `npm run check-settings`. It is generated rather than
// hand-kept for the obvious reason: eighty-eight rows spread over two files
// will drift from any list a human maintains, and a search that silently stops
// finding a row is worse than no search — the reader concludes the setting does
// not exist.
//
// It carries KEYS, not words. The search resolves them through `t()` at the
// moment it runs, so an Arabic instance searches Arabic labels and an English
// one searches English, from one index.

import type { I18nKey } from "../../i18n.ts";

export interface SettingEntry {
  /** The tab this row lives on — `TABS[].id` in SettingsModal.tsx. */
  tab: string;
  /** The row's label key. Also how a result finds its row in the DOM: `Row`
   *  stamps the RESOLVED label as `data-setting`, and the result resolves the
   *  same key to look it up. */
  label: I18nKey;
  hint?: I18nKey;
  /** The environment variable behind the row's ⓘ, when it has one. Searching
   *  `SITE_LANG` and landing on the row is the operator's half of this. */
  env?: string;
}

export const SETTINGS_INDEX: SettingEntry[] = [
  { tab: "device", label: "rowYourTheme", hint: "hintYourTheme" },
  { tab: "device", label: "rowEditorLanguage", hint: "hintEditorLanguage" },
  { tab: "device", label: "rowSidebarSide", hint: "hintSidebarSide" },
  { tab: "device", label: "rowVimKeys", hint: "hintVimKeys" },
  { tab: "device", label: "selToolbarLabel", hint: "hintSelToolbar" },
  { tab: "device", label: "rowHeadingNumbers", hint: "hintHeadingNumbers" },
  { tab: "identity", label: "rowSiteName", env: "SITE_NAME" },
  { tab: "identity", label: "rowTagline", hint: "hintTagline", env: "SITE_TAGLINE" },
  { tab: "identity", label: "rowFooter", hint: "hintFooter", env: "SITE_FOOTER" },
  { tab: "identity", label: "rowLogo", hint: "hintLogo" },
  { tab: "identity", label: "rowFavicon", hint: "hintFavicon" },
  { tab: "language", label: "rowLanguage", hint: "hintLanguage", env: "SITE_LANG" },
  { tab: "language", label: "rowDateLocale", hint: "hintDateLocale", env: "BLOG_LOCALE" },
  { tab: "language", label: "rowLanguageFilter", hint: "hintLanguageFilter", env: "LANGUAGE_FILTER" },
  { tab: "language", label: "rowLanguageToggle", hint: "hintLanguageToggle" },
  { tab: "language", label: "rowDateCalendar", hint: "hintDateCalendar" },
  { tab: "language", label: "rowTextDirection", hint: "hintTextDirection" },
  { tab: "language", label: "rowTextAlign", hint: "hintTextAlign" },
  { tab: "language", label: "tagLabelsRowLabel", hint: "tagLabelsPageWins" },
  { tab: "publishing", label: "rowDefaultTheme", hint: "hintDefaultTheme", env: "DEFAULT_THEME" },
  { tab: "publishing", label: "rowPublicLayout", hint: "hintPublicLayout", env: "PUBLIC_LAYOUT" },
  { tab: "publishing", label: "rowOpenDesigner", hint: "hintOpenDesigner" },
  { tab: "publishing", label: "rowExcludeTags", hint: "hintExcludeTags", env: "EXCLUDE_TAGS" },
  { tab: "publishing", label: "rowComments", hint: "hintComments", env: "COMMENTS" },
  { tab: "publishing", label: "rowShareButtons", hint: "hintShareButtons" },
  { tab: "publishing", label: "rowAuthorSites", hint: "hintAuthorSites" },
  { tab: "publishing", label: "rowPublicFolders", hint: "hintPublicFolders" },
  { tab: "publishing", label: "rowPublicFoldersList", hint: "hintPublicFoldersList" },
  { tab: "publishing", label: "rowPublicFoldersHome", hint: "hintPublicFoldersHome" },
  { tab: "publishing", label: "rowPublicFoldersNav", hint: "hintPublicFoldersNav" },
  { tab: "publishing", label: "rowMode", hint: "hintMode" },
  { tab: "publishing", label: "rowHomeNote", hint: "hintHomeNote", env: "HOME_NOTE" },
  { tab: "publishing", label: "rowHomeBanner", hint: "hintHomeBanner" },
  { tab: "vault", label: "templatesFolderLabel", hint: "templatesFolderHint" },
  { tab: "vault", label: "defaultTemplateLabel", hint: "defaultTemplateHint" },
  { tab: "vault", label: "rowAttachmentLocation", hint: "hintAttachmentLocation" },
  { tab: "vault", label: "rowAttachmentFolder" },
  { tab: "vault", label: "rowTagsFolder", hint: "hintTagsFolder" },
  { tab: "typography", label: "rowFontProse", hint: "hintFontProse" },
  { tab: "typography", label: "rowFontUi", hint: "hintFontUi" },
  { tab: "typography", label: "rowFontMono", hint: "hintFontMono" },
  { tab: "typography", label: "rowFontArabic", hint: "hintFontArabic" },
  { tab: "typography", label: "rowSizeAdjust", hint: "hintSizeAdjust" },
  { tab: "sync", label: "rowSyncEnabled", hint: "hintSyncEnabled" },
  { tab: "sync", label: "rowSyncRemote", hint: "hintSyncRemote" },
  { tab: "sync", label: "rowSyncBranch", hint: "hintSyncBranch" },
  { tab: "sync", label: "rowSyncAuth", hint: "hintSyncAuth" },
  { tab: "sync", label: "rowSyncUser", hint: "hintSyncUser" },
  { tab: "sync", label: "rowSyncToken", hint: "hintSyncToken" },
  { tab: "sync", label: "rowSyncPull", hint: "hintSyncPull" },
  { tab: "sync", label: "rowSyncInterval", hint: "hintSyncInterval" },
  { tab: "sync", label: "rowSyncStatus", hint: "hintSyncStatus" },
];

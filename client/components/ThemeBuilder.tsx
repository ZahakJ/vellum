// THE CUSTOM THEME BUILDER.
//
// Pick one of the built-ins as a base, override any token, watch the whole app
// change under the panel while you do it, and be told — inline, next to the
// swatch you are dragging — when a choice breaks one of the product's own
// contrast rules.
//
// Three things make it honest rather than decorative:
//
//  1. THE PREVIEW IS THE APP. Like the theme picker, edits are applied to the
//     live document (a `<style>` element under a reserved `__preview` id), not
//     to a mock. A theme is a room; the only preview of a room is the room.
//     Nothing is persisted until Save, and closing restores what was in force.
//
//  2. THE WARNINGS ARE THE GATE. `shared/contrast.ts` is the single
//     implementation of the WCAG ratios, the ΔE distance and every floor —
//     `scripts/check-contrast.mjs` imports the same functions. A builder with
//     its own copy of the formula would eventually bless a theme the gate
//     rejects, and that is the theme that ships.
//
//  3. UNSET IS A REAL STATE. A custom theme stores only what its author
//     CHANGED, so a token left alone keeps coming from tokens.css — including
//     after an upstream retune. Every row therefore has a "reset" that deletes
//     rather than re-derives, and the panel shows the inherited value in the
//     field it would take.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MAX_CUSTOM_THEMES,
  THEME_NAME_MAX,
  THEME_TOKENS,
  customThemeChoice,
  customThemesCss,
  isValidTokenValue,
  type CustomTheme,
  type TokenGroup,
  type TokenSpec,
} from "../../shared/customTheme.ts";
import { checkTheme, type ContrastCheck } from "../../shared/contrast.ts";
import { THEMES, themeGroup, type Theme, type ThemeGroup } from "../../shared/themes.ts";
import {
  createCustomTheme,
  deleteCustomThemeById,
  saveCustomTheme,
} from "../design/api.ts";
import {
  applyThemeChoice,
  getCustomThemes,
  invalidateCustomThemes,
  reloadCustomThemes,
} from "../design/customThemes.ts";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { THEME_LABELS } from "../themes.ts";
import { confirmModal } from "./Confirm.tsx";
import { toast } from "../toast.ts";
import "../styles/themebuilder.css";

/** The `data-custom-theme` value the live preview borrows. It can never
 *  collide with a real theme: the store's slug grammar forbids a leading
 *  underscore. */
const PREVIEW_ID = "__preview";

const GROUP_LABELS: Record<TokenGroup, string> = {
  ground: "tbGroupGround",
  text: "tbGroupText",
  accent: "tbGroupAccent",
  line: "tbGroupLine",
  callout: "tbGroupCallout",
  code: "tbGroupCode",
  graph: "tbGroupGraph",
} as unknown as Record<TokenGroup, string>;

const GROUP_ORDER: TokenGroup[] = [
  "ground",
  "text",
  "accent",
  "line",
  "callout",
  "code",
  "graph",
];

/** A computed CSS colour → the hex grammar the store accepts. `getComputedStyle`
 *  hands back whatever tokens.css wrote — `#c9a227` for most tokens and
 *  `rgba(201, 162, 39, 0.14)` for the three washes — and both have to become a
 *  value a `<input type="color">` and the validator will take. */
function toHex(value: string): string {
  const raw = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw.toLowerCase();
  const m = /^rgba?\(([^)]+)\)$/i.exec(raw);
  if (!m) return "#000000";
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  const byte = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const [r, g, b] = parts.slice(0, 3).map((p) => Number.parseFloat(p));
  const a = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
  const base = `#${byte(r)}${byte(g)}${byte(b)}`;
  return a >= 1 ? base : `${base}${byte(a * 255)}`;
}

/**
 * The base theme's resolved tokens, read off the LIVE document.
 *
 * Not a copy of tokens.css and deliberately not one: a table in the client
 * would be a second definition of the built-in themes, and it would go stale the
 * first time a theme is retuned. A detached probe element carrying
 * `data-theme` gets the real cascade — including `custom.css`, which an
 * operator may legitimately have used to change a base — so what the builder
 * measures is what the reader will see.
 */
function readBaseTokens(base: Theme): Record<string, string> {
  const probe = document.createElement("div");
  probe.setAttribute("data-theme", base);
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe);
  const out: Record<string, string> = {};
  for (const spec of THEME_TOKENS) {
    const value = computed.getPropertyValue(spec.name);
    if (value.trim() !== "") out[spec.name] = toHex(value);
  }
  probe.remove();
  return out;
}

interface Draft {
  id: string | null;
  name: string;
  base: Theme;
  group: ThemeGroup;
  tokens: Record<string, string>;
}

function draftFrom(theme: CustomTheme | null): Draft {
  if (theme) {
    return {
      id: theme.id,
      name: theme.name,
      base: theme.base,
      group: theme.group,
      tokens: { ...theme.tokens },
    };
  }
  return { id: null, name: "", base: THEMES[0], group: themeGroup(THEMES[0]), tokens: {} };
}

function ThemeBuilder({ theme, onClose }: { theme: CustomTheme | null; onClose: () => void }) {
  useStore((s) => s.language);
  const themeInForce = useRef(useStore.getState().theme);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(theme));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<TokenGroup>("ground");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const baseTokens = useMemo(() => readBaseTokens(draft.base), [draft.base]);
  const resolved = useMemo(
    () => ({ ...baseTokens, ...draft.tokens }),
    [baseTokens, draft.tokens],
  );

  // The gate, live. Same functions scripts/check-contrast.mjs calls.
  const checks = useMemo(() => checkTheme(resolved), [resolved]);
  const failures = useMemo(() => checks.filter((check) => !check.pass), [checks]);

  // ── Live preview ────────────────────────────────────────────────────────
  // A single <style> element carrying the draft as the reserved preview id.
  // The generator is the SHARED one, so what is on screen is byte-identical to
  // what /api/design/themes.css will serve after Save — a preview produced by
  // a different code path is a preview of a different thing.
  useEffect(() => {
    let style = document.head.querySelector<HTMLStyleElement>("style[data-vellum-tb]");
    if (!style) {
      style = document.createElement("style");
      style.setAttribute("data-vellum-tb", "");
      document.head.appendChild(style);
    }
    style.textContent = customThemesCss([
      {
        id: PREVIEW_ID,
        name: draft.name,
        base: draft.base,
        group: draft.group,
        tokens: draft.tokens,
        createdMs: 0,
        updatedMs: 0,
      },
    ]);
    const root = document.documentElement;
    root.setAttribute("data-theme", draft.base);
    root.setAttribute("data-custom-theme", PREVIEW_ID);
  }, [draft]);

  // Leaving puts back the theme that was in force — the picker's rule, and the
  // reason an author can experiment without committing to anything.
  const committed = useRef(false);
  useEffect(
    () => () => {
      document.head.querySelector("style[data-vellum-tb]")?.remove();
      if (!committed.current) applyThemeChoice(themeInForce.current);
    },
    [],
  );

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Nothing here owns Esc more than the panel does, except a confirm
      // dialog — which stops propagation itself, exactly as elsewhere.
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  const setToken = (name: string, value: string): void => {
    setDraft((d) => ({ ...d, tokens: { ...d.tokens, [name]: value } }));
  };

  const resetToken = (name: string): void => {
    setDraft((d) => {
      const tokens = { ...d.tokens };
      delete tokens[name];
      return { ...d, tokens };
    });
  };

  /** Refresh the registry AND the stylesheet, so every picker behind the panel
   *  is correct when it closes and the theme just saved actually paints. The
   *  stylesheet half is the one that bites: its link is served `immutable`, so
   *  without a fresh signature the browser answers from cache and the new
   *  theme renders as its bare base. */
  const refresh = async (): Promise<void> => {
    invalidateCustomThemes();
    try {
      await reloadCustomThemes();
    } catch {
      /* the save succeeded; a stale picker is not worth a second error */
    }
  };

  const save = async (): Promise<void> => {
    setError(null);
    if (draft.name.trim() === "") {
      setError(t("tbNeedName"));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: draft.name.trim(),
        base: draft.base,
        group: draft.group,
        tokens: draft.tokens,
      };
      const saved = draft.id
        ? await saveCustomTheme(draft.id, payload)
        : await createCustomTheme(payload);
      await refresh();
      committed.current = true;
      // Saving SELECTS it. Anything else would leave the author looking at a
      // preview of a theme they have to go and find in another panel.
      useStore.getState().setTheme(customThemeChoice(saved.id));
      toast(tf("tbSaved", { name: saved.name }));
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!draft.id) return;
    const ok = await confirmModal({
      title: t("tbDeleteTitle"),
      body: tf("tbDeleteBody", { name: draft.name }),
      confirmLabel: t("delete"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCustomThemeById(draft.id);
      await refresh();
      // The theme in force may have been the one just deleted; put the reader
      // back on a theme that exists rather than on a dangling attribute.
      const current = useStore.getState().theme;
      if (current === customThemeChoice(draft.id)) {
        committed.current = true;
        useStore.getState().setTheme(draft.base);
      }
      toast(t("tbDeleted"));
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  /** Export: the theme as JSON, handed to the browser as a file. Downloading
   *  rather than copying because a theme is a thing you keep, mail and put in
   *  a repository. */
  const exportTheme = (): void => {
    const payload = JSON.stringify(
      { kind: "vellum.theme", name: draft.name, base: draft.base, group: draft.group, tokens: draft.tokens },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.name.trim() || "theme"}.vellum-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Import: read a file into the DRAFT, never straight into the store. The
   *  author sees what arrived, live, before anything is saved — and a file
   *  that is not a theme says so in one sentence instead of forty field
   *  errors. */
  const importFile = async (file: File): Promise<void> => {
    setError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      const raw = parsed as Record<string, unknown>;
      if (raw.kind !== undefined && raw.kind !== "vellum.theme") {
        setError(t("tbNotATheme"));
        return;
      }
      const base = THEMES.includes(raw.base as Theme) ? (raw.base as Theme) : draft.base;
      const tokens: Record<string, string> = {};
      const rawTokens = (raw.tokens ?? {}) as Record<string, unknown>;
      for (const spec of THEME_TOKENS) {
        const value = rawTokens[spec.name];
        if (typeof value === "string" && isValidTokenValue(spec.kind, value)) {
          tokens[spec.name] = value.toLowerCase();
        }
      }
      setDraft((d) => ({
        ...d,
        name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : d.name,
        base,
        group:
          raw.group === "dark" || raw.group === "light" ? raw.group : themeGroup(base),
        tokens,
      }));
    } catch {
      setError(t("tbNotATheme"));
    }
  };

  const full = getCustomThemes().length >= MAX_CUSTOM_THEMES && draft.id === null;

  return (
    <div className="s-palette-overlay s-tb-overlay" onMouseDown={close}>
      <div
        className="s-tb"
        role="dialog"
        aria-label={t("tbTitle")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="s-tb__head">
          <span className="s-tb__title">{t("tbTitle")}</span>
          <span className="s-tb__hint">{t("tbHint")}</span>
          <button type="button" className="s-bmodal__close" onClick={close} aria-label={t("close")}>
            ×
          </button>
        </header>

        <div className="s-tb__body">
          <div className="s-tb__form">
            <label className="s-tb__field">
              <span className="s-tb__label">{t("tbName")}</span>
              <input
                className="s-tb__input"
                value={draft.name}
                maxLength={THEME_NAME_MAX}
                dir="auto"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <div className="s-tb__field s-tb__field--wide">
              <span className="s-tb__label">{t("tbBase")}</span>
              {/* One of the built-ins, CHOSEN BY LOOKING AT IT — the theme
                  picker's whole argument, applied to the one control that
                  decides where every unset token comes from. A native select
                  would draw an OS window this room cannot reach (the rule the
                  settings panel states) and would name a column of pigment nouns
                  with nothing saying what any of them looks like. The swatches
                  are the CONSTANT --swatch-<id>-* tokens, so each one is
                  painted in its own theme rather than in the draft on screen.
                  Changing the base re-reads every inherited value from the
                  live document: the overrides stay and everything under them
                  moves. */}
              <div className="s-tb__bases" role="radiogroup" aria-label={t("tbBase")}>
                {THEMES.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={draft.base === id}
                    className={`s-tb__base${draft.base === id ? " s-tb__base--on" : ""}`}
                    title={t(THEME_LABELS[id].name)}
                    onClick={() => setDraft((d) => ({ ...d, base: id, group: themeGroup(id) }))}
                  >
                    <span className="s-tb__basecard" data-theme-swatch={id} aria-hidden="true">
                      <span className="s-tb__baseline" />
                      <span className="s-tb__basechip" />
                    </span>
                    <span className="s-tb__basename">{t(THEME_LABELS[id].name)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="s-tb__field">
              <span className="s-tb__label">{t("tbGroup")}</span>
              <div className="s-tb__seg">
                {(["dark", "light"] as const).map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={`s-tb__segbtn${draft.group === group ? " s-tb__segbtn--on" : ""}`}
                    onClick={() => setDraft((d) => ({ ...d, group }))}
                  >
                    {t(group === "dark" ? "themeGroupDark" : "themeGroupLight")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* THE WARNINGS. Not a badge and not a tooltip: the whole failing
              set, in words, above the controls that cause them — a rule the
              author cannot see is a rule they will break. */}
          <div className={`s-tb__gate${failures.length === 0 ? " s-tb__gate--ok" : ""}`}>
            {failures.length === 0 ? (
              <p className="s-tb__gateline">{t("tbAllClear")}</p>
            ) : (
              failures.map((check) => (
                <p className="s-tb__gateline" key={check.id}>
                  {warningFor(check)}
                </p>
              ))
            )}
          </div>

          <nav className="s-tb__tabs" role="tablist" aria-label={t("tbTokens")}>
            {GROUP_ORDER.map((group) => {
              const failed = failures.some((check) =>
                THEME_TOKENS.some(
                  (spec) => spec.group === group && (spec.name === check.token || spec.name === check.against),
                ),
              );
              return (
                <button
                  key={group}
                  type="button"
                  role="tab"
                  aria-selected={openGroup === group}
                  className={`s-tb__tab${openGroup === group ? " s-tb__tab--on" : ""}${
                    failed ? " s-tb__tab--warn" : ""
                  }`}
                  onClick={() => setOpenGroup(group)}
                >
                  {t(GROUP_LABELS[group] as never)}
                </button>
              );
            })}
          </nav>

          <div className="s-tb__tokens">
            {THEME_TOKENS.filter((spec) => spec.group === openGroup).map((spec) => (
              <TokenRow
                key={spec.name}
                spec={spec}
                value={draft.tokens[spec.name]}
                inherited={baseTokens[spec.name] ?? "#000000"}
                failing={failures.some((check) => check.token === spec.name)}
                onChange={(value) => setToken(spec.name, value)}
                onReset={() => resetToken(spec.name)}
              />
            ))}
          </div>
        </div>

        <footer className="s-tb__foot">
          {error && <span className="s-tb__error">{error}</span>}
          {full && <span className="s-tb__error">{tf("tbFull", { max: MAX_CUSTOM_THEMES })}</span>}
          <span className="s-tb__spacer" />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="s-tb__file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = "";
            }}
          />
          <button type="button" className="s-btn" onClick={() => fileRef.current?.click()}>
            {t("tbImport")}
          </button>
          <button type="button" className="s-btn" onClick={exportTheme}>
            {t("tbExport")}
          </button>
          {draft.id && (
            <button type="button" className="s-btn s-tb__danger" onClick={() => void remove()}>
              {t("delete")}
            </button>
          )}
          <button type="button" className="s-btn" onClick={close}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="s-btn s-btn--accent"
            onClick={() => void save()}
            disabled={busy || full}
          >
            {t("save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** One failing check, as a sentence. Keyed off the check's own `kind` rather
 *  than its id, so a floor added upstream reads correctly here without a
 *  second edit. */
function warningFor(check: ContrastCheck): string {
  if (check.kind === "deltaE") {
    return tf("tbWarnDeltaE", { value: check.value.toFixed(1), min: check.min });
  }
  return tf("tbWarnRatio", {
    token: check.token,
    ground: check.against,
    value: check.value.toFixed(2),
    min: check.min,
  });
}

function TokenRow({
  spec,
  value,
  inherited,
  failing,
  onChange,
  onReset,
}: {
  spec: TokenSpec;
  value: string | undefined;
  inherited: string;
  failing: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const set = value !== undefined;
  const shown = value ?? inherited;
  // <input type="color"> only speaks #rrggbb; a wash keeps its alpha in the
  // TEXT field beside it, which is the field that actually stores the value.
  const swatch = shown.length > 7 ? shown.slice(0, 7) : shown;
  const invalid = set && !isValidTokenValue(spec.kind, shown);
  return (
    <div className={`s-tb__row${failing ? " s-tb__row--warn" : ""}`}>
      <span className="s-tb__token" dir="ltr">
        {spec.name}
      </span>
      <input
        type="color"
        className="s-tb__swatch"
        value={/^#[0-9a-f]{6}$/i.test(swatch) ? swatch : "#000000"}
        onChange={(e) =>
          onChange(
            spec.kind === "wash" && shown.length === 9
              ? `${e.target.value}${shown.slice(7)}`
              : e.target.value,
          )
        }
        aria-label={spec.name}
      />
      <input
        className={`s-tb__hex${invalid ? " s-tb__hex--bad" : ""}`}
        value={shown}
        dir="ltr"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-label={spec.name}
      />
      <button
        type="button"
        className="s-tb__reset"
        onClick={onReset}
        disabled={!set}
        title={t("tbResetToken")}
        aria-label={t("tbResetToken")}
      >
        ⟲
      </button>
      <span className={`s-tb__state${set ? " s-tb__state--set" : ""}`}>
        {set ? t("tbSet") : t("tbInherited")}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imperative mount, the toast.ts / ThemePicker.tsx shape: the builder is
// opened from the theme picker and could be opened from anywhere else, so it
// owns its own root on <body> rather than living inside one component tree.
// ---------------------------------------------------------------------------

let host: HTMLDivElement | null = null;
let root: Root | null = null;

export function isThemeBuilderOpen(): boolean {
  return host !== null;
}

export function closeThemeBuilder(): void {
  if (!root || !host) return;
  const [r, h] = [root, host];
  root = null;
  host = null;
  setTimeout(() => {
    r.unmount();
    h.remove();
  }, 0);
}

/** Open the builder on an existing theme, or on a blank draft. */
export function openThemeBuilder(theme: CustomTheme | null = null): void {
  if (host) return;
  host = document.createElement("div");
  host.className = "s-tb-host";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ThemeBuilder theme={theme} onClose={closeThemeBuilder} />);
}

export default ThemeBuilder;

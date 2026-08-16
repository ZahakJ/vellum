// The template picker: a filtered list of the templates folder on one side,
// the chosen template's BODY on the other.
//
// The preview is not decoration. A template is a file whose name ("Meeting",
// "Daily") says almost nothing about what it will put in the note, and the
// difference between two of them is often three lines of frontmatter. Picking
// one blind — and then discovering what it did by reading the note it just
// rewrote — is how a reader ends up undoing an insert they did not want. So
// the panel shows what is about to be inserted, with the placeholders ALREADY
// FILLED: `{{date}}` previews as today's date, because that is what will land.
//
// Both commands open this. "Insert template…" puts the body at the cursor and
// folds the template's frontmatter into the note's own block; "New note from
// template…" asks for a name first and creates the note from it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TreeNode } from "../../shared/types.ts";
import { getNote } from "../api.ts";
import { autoDir, t, tf } from "../i18n.ts";
import { noteTitleOf } from "../../shared/noteFormat.ts";
import {
  applyPlaceholders,
  splitFrontmatter,
  templateProperties,
  templateSettings,
  type TemplateProperty,
  type TemplateSettings,
} from "../templates.ts";
import { useStore } from "../state.ts";

/** How much of a template's body the preview shows. A template is a stencil;
 *  anything longer than this is being read, not glanced at. */
const PREVIEW_MAX = 4000;

export interface TemplatePickerRequest {
  /** Title of the dialog — the two commands name themselves. */
  title: string;
  /** The note the placeholders should fill against (its name becomes
   *  `{{title}}` in the preview). Null when the caller has not named one yet. */
  previewTitle: string;
  /** Resolves with the chosen template's vault path, or null on cancel. */
  resolve: (path: string | null) => void;
}

let openPicker: ((request: TemplatePickerRequest) => void) | null = null;

/** Open the picker and resolve with the chosen template path (null = cancel).
 *  Mirrors moveViaPicker()/confirmModal(): the caller awaits a promise and
 *  never touches the component. */
export function pickTemplate(title: string, previewTitle: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!openPicker) {
      resolve(null);
      return;
    }
    openPicker({ title, previewTitle, resolve });
  });
}

export default function TemplatePicker() {
  const [request, setRequest] = useState<TemplatePickerRequest | null>(null);
  const [settings, setSettings] = useState<TemplateSettings | null>(null);
  const [templates, setTemplates] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<{
    path: string;
    body: string;
    props: TemplateProperty[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tree = useStore((s) => s.tree);
  useStore((s) => s.language); // re-render chrome strings on a language switch

  useEffect(() => {
    openPicker = (next) => {
      setRequest(next);
      setFilter("");
      setSelected(0);
      setPreview(null);
      // A transient failure must not be permanent: without this, one dropped
      // request leaves every later open reading "Could not load the templates"
      // for the rest of the session.
      setFailed(false);
    };
    return () => {
      openPicker = null;
    };
  }, []);

  const close = useCallback(
    (path: string | null) => {
      setRequest((current) => {
        current?.resolve(path);
        return null;
      });
    },
    [],
  );

  // The folder in force, and the notes inside it. The tree is already in the
  // store — no request needed, and the list follows a rename live.
  useEffect(() => {
    if (!request) return;
    let disposed = false;
    templateSettings()
      .then((s) => {
        if (!disposed) setSettings(s);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      disposed = true;
    };
  }, [request]);

  useEffect(() => {
    if (!settings?.folder || !tree) {
      setTemplates(settings === null ? null : []);
      return;
    }
    setTemplates(notesUnder(tree, settings.folder));
  }, [settings, tree]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = templates ?? [];
    return q === "" ? list : list.filter((p) => p.toLowerCase().includes(q));
  }, [templates, filter]);

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Load the highlighted template's body, placeholders filled — what the
  // reader is about to get, not what the file says.
  const active = filtered[selected] ?? null;
  useEffect(() => {
    if (!active || !request || !settings) return;
    let disposed = false;
    getNote(active)
      .then((note) => {
        if (disposed) return;
        const vars = {
          title: request.previewTitle,
          now: new Date(),
          locale: settings.locale,
          calendar: settings.calendar,
          lang: settings.lang,
        };
        // BOTH HALVES, filled. The frontmatter is previewed because it is
        // where two templates usually differ — and because one of its keys
        // publishes the note (client/templates.ts::templateProperties).
        const split = splitFrontmatter(applyPlaceholders(note.content, vars));
        setPreview({
          path: active,
          body: split.body.slice(0, PREVIEW_MAX),
          props: templateProperties(split.yaml),
        });
      })
      .catch(() => {
        if (!disposed) setPreview({ path: active, body: "", props: [] });
      });
    return () => {
      disposed = true;
    };
  }, [active, request, settings]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        close(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request, close]);

  if (!request) return null;

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      close(active);
    }
  };

  return (
    <div className="s-palette-overlay" onMouseDown={() => close(null)}>
      <div
        className="s-bmodal s-tmpl"
        role="dialog"
        aria-label={request.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          <span className="s-bmodal__title">{request.title}</span>
          <button
            type="button"
            className="s-bmodal__close"
            onClick={() => close(null)}
            aria-label={t("close")}
          >
            ×
          </button>
        </div>

        <input
          ref={inputRef}
          className="s-bmodal__input"
          type="text"
          placeholder={t("templateFilterPlaceholder")}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />

        <div className="s-tmpl__body">
          <div className="s-tmpl__list">
            {templates === null && !failed && <div className="s-bmodal__empty">{t("loading")}</div>}
            {failed && <div className="s-bmodal__empty">{t("templatesFailed")}</div>}
            {/* THE EMPTY STATE HAS TO SAY WHICH EMPTY IT IS. "No templates"
                when the folder is unset means "go configure a folder"; when
                the folder is set and empty it means "put a file in it". One
                message for both is the reader guessing. */}
            {!failed && templates !== null && filtered.length === 0 && (
              <div className="s-bmodal__empty">
                {settings?.folder === null || settings?.folder === undefined
                  ? t("templatesNoFolder")
                  : templates.length === 0
                    ? tf("templatesFolderEmpty", { folder: settings.folder })
                    : t("noMatchesDot")}
              </div>
            )}
            {filtered.map((path, i) => (
              <button
                key={path}
                type="button"
                className={`s-tmpl__item${i === selected ? " s-tmpl__item--active" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => close(path)}
              >
                <span className="s-tmpl__name" dir="auto">
                  {noteTitleOf(path)}
                </span>
                <span className="s-tmpl__path" dir="auto">
                  {path}
                </span>
              </button>
            ))}
          </div>
          <div className="s-tmpl__preview">
            {preview === null ? (
              <div className="s-tmpl__previewempty">{t("templatePreviewHint")}</div>
            ) : (
              <>
                {/* THE FRONTMATTER, FIRST. It is the half that decides where
                    the note goes, and it is where two templates with the same
                    one-line body differ. Rows, never the raw `---` block:
                    the picker is outside the editor. */}
                <div className="s-tmpl__propshead">{t("templateSetsProps")}</div>
                {preview.props.length === 0 ? (
                  <div className="s-tmpl__noprops">{t("templateNoProps")}</div>
                ) : (
                  <dl className="s-tmpl__props">
                    {preview.props.map((p) => (
                      <div
                        key={p.key}
                        className={`s-tmpl__prop${p.publishes ? " s-tmpl__prop--publish" : ""}`}
                      >
                        <dt className="s-tmpl__propkey" dir="auto">
                          {p.key}
                        </dt>
                        <dd className="s-tmpl__propval" dir="auto">
                          {p.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {preview.props.some((p) => p.publishes) && (
                  <div className="s-tmpl__publishwarn">
                    <span className="s-tmpl__publishmark" aria-hidden="true">
                      ✦
                    </span>
                    {t("templatePublishWarn")}
                  </div>
                )}
                <div className="s-tmpl__propshead s-tmpl__propshead--body">
                  {t("templateBodyLabel")}
                </div>
                {preview.body.trim() !== "" ? (
                  /* ONE DIRECTION FOR THE WHOLE BLOCK. `dir="auto"` on a
                     `<pre>` resolves per PARAGRAPH, and every newline in a
                     `pre` ends one — so an Arabic template's Latin line flew
                     to the opposite edge of the box while its neighbours
                     stayed put. Resolved once, over the whole body. */
                  <pre className="s-tmpl__pre" dir={autoDir(preview.body)}>
                    {preview.body}
                  </pre>
                ) : (
                  <div className="s-tmpl__previewempty">{t("templateEmptyBody")}</div>
                )}
              </>
            )}
          </div>
        </div>

        {settings?.folder && (
          <div className="s-tmpl__foot">
            {settings.detected
              ? tf("templatesFolderDetected", { folder: settings.folder })
              : tf("templatesFolderIs", { folder: settings.folder })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Note paths under `folder`, from the tree the sidebar already holds — no
 *  request, and the list follows a rename or a new file live. Attachments are
 *  excluded: an image in the templates folder is not a template. */
function notesUnder(root: TreeNode, folder: string): string[] {
  const out: string[] = [];
  const prefix = `${folder}/`;
  const walk = (node: TreeNode): void => {
    if (node.type === "file") {
      if (!node.attachment && node.path.startsWith(prefix)) out.push(node.path);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

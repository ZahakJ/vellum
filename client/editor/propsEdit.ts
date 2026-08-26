// The properties card, editable in place — Obsidian parity #1 (v1.8 spec K).
//
// WHAT THIS IS FOR. Frontmatter is the one part of a note the product renders
// as CHROME: a card, not text. Until now that card was display-only, so the
// only way to change a property was to click into the card, watch it turn back
// into raw YAML, and edit the YAML by hand — which is exactly the workflow the
// card exists to spare the reader, and exactly what people ask Obsidian for.
// Obsidian shipped an editor and it round-trips YAML through a serializer, so
// it reformats quote styles, drops comments and reorders keys it did not
// touch. Vellum's writes are byte-surgical (server/frontmatterEdit.ts) and the
// property test in tests/frontmatter.test.ts is the promise, not the prose.
//
// WHERE THE WRITE GOES, and why not through the buffer. The obvious
// implementation edits the CodeMirror document: the YAML is right there, and
// the buffer already knows how to save. It is the wrong seam. A frontmatter
// edit through the buffer is a text edit, so it inherits the buffer's whole
// world — the autosave debounce, the 409 precondition dance, the undo history
// (Ctrl Z after ticking a checkbox would eat the last paragraph you typed),
// and a diff CodeMirror computes rather than one this product controls. Worse,
// it has to CONSTRUCT the YAML client-side, which puts a second frontmatter
// writer in the product; two writers is how the release's central claim stops
// being true. So every write here rides POST /api/frontmatter, the same route
// and the same choreography `setBanner` has used since v1.2 — let the pending
// autosave land, claim the SSE echo, write one property, reload the pane.
//
// THIS MODULE IS EDITOR-ONLY, by construction rather than by a flag. The card
// builder (client/editor/noteMeta.ts) takes the editing layer as two callbacks
// and the reading-view renderer passes neither, so rollup never pulls an input
// element into the first-paint chunk a blog visitor downloads.

import { t, tf } from "../i18n.ts";
import type { PropertyValue } from "../../shared/types.ts";
import type { PropRow, PropsCardOpts } from "./noteMeta.ts";

/** Keys that are a LIST even when the file currently spells one value.
 *  `tags: draft` is a list of one to every tool that reads it, and a card that
 *  offered a text box for it would quietly turn the second tag into the string
 *  "draft, idea". */
const LIST_KEYS = new Set([
  "tags",
  "aliases",
  "alias",
  "folders",
  "folder",
  "cssclasses",
  "categories",
  "keywords",
]);

type PropKind = "list" | "bool" | "date" | "text";

/** What control this row gets. Read from the value's RAW spelling, never from
 *  its printed text: `true` is a checkbox, `"true"` is a word somebody typed. */
function kindOf(row: PropRow): PropKind {
  if (row.list || LIST_KEYS.has(row.key.toLowerCase())) return "list";
  if (/^(true|false)$/.test(row.raw)) return "bool";
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.raw)) return "date";
  return "text";
}

/** The one way this module reaches the vault. A CustomEvent rather than a
 *  store import, for the reason the "Set banner…" button next to it uses one:
 *  the editor chunk is UI-framework-free and knows nothing about zustand, and
 *  a widget's DOM outlives the render that built it. `path` travels with the
 *  event because a split can put two notes on screen and the card that was
 *  clicked is not always the focused pane's. */
function write(path: string, key: string, value: PropertyValue | null): void {
  window.dispatchEvent(
    new CustomEvent("vellum:property", { detail: { path, key, value } }),
  );
}

/** A 10px cross, drawn rather than typed: the `×` character is a MULTIPLICATION
 *  SIGN wearing the note's own font, and beside an Arabic value it inherits the
 *  run's direction and drifts. Same reasoning as the tag pill's `<bdi>`. */
function crossIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<path d="M6 6l12 12M18 6L6 18"/>';
  return svg;
}

/** Every keystroke inside a card input stays inside it.
 *
 *  The card is a block widget INSIDE `.cm-content`, and CodeMirror's keymap
 *  listens on the editor root. Without this, typing `b` in a value box with a
 *  modifier held ran the editor's binding, and Esc reached the shell's global
 *  handler and left zen mode. The two keys this layer owns are handled here
 *  and nothing else is forwarded. */
function ownKeys(el: HTMLElement, commit: () => void, cancel: () => void): void {
  el.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      ev.preventDefault();
      commit();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });
}

/** A pointer gesture that belongs to a control, not to the document under it.
 *  Clicks inside the widget must never resolve into a document position and
 *  swap the card for raw YAML — the failure the header's mousedown branch in
 *  livePreview.ts exists to prevent, arriving now from inside the card. */
function ownPointer(el: HTMLElement): void {
  el.addEventListener("mousedown", (ev) => ev.stopPropagation());
}

function input(value: string, type: "text" | "date"): HTMLInputElement {
  const box = document.createElement("input");
  box.className = "cm-s-props__input";
  box.type = type;
  box.value = value;
  // Note-derived text inside chrome takes its OWN direction — the same rule
  // the printed value follows two lines up in the card.
  if (type === "text") box.dir = "auto";
  box.spellcheck = false;
  ownPointer(box);
  return box;
}

/** Swap a control for its input, focus it, and put it back when the reader
 *  leaves without committing. Returns nothing: the pane reloads on a
 *  successful write and the card is rebuilt from the file's own bytes, which
 *  is the only version of the truth this layer trusts. */
function edit(
  host: HTMLElement,
  box: HTMLInputElement,
  restore: () => void,
  apply: (text: string) => void,
): void {
  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    const text = box.value.trim();
    restore();
    if (commit) apply(text);
  };
  ownKeys(box, () => finish(true), () => finish(false));
  // A blur COMMITS. The alternative — blur cancels — loses a value the reader
  // typed because they clicked the next row, and this product's rule for typed
  // text is that it survives the gesture that interrupted it.
  box.addEventListener("blur", () => finish(true));
  host.replaceChildren(box);
  box.focus();
  box.select?.();
}

/** The editing layer, bound to one note. Handed to `buildPropsCard`. */
export function propsEditor(notePath: string): Pick<PropsCardOpts, "editRow" | "footer"> {
  const set = (key: string, value: PropertyValue | null): void => write(notePath, key, value);

  const editRow = (row: PropRow, valueEl: HTMLElement, rowEl: HTMLElement): void => {
    const kind = kindOf(row);
    if (kind === "list") listRow(row, valueEl, set);
    else if (kind === "bool") boolRow(row, valueEl, set);
    else scalarRow(row, valueEl, kind, set);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "cm-s-props__del";
    del.title = tf("propRemove", { key: row.key });
    del.setAttribute("aria-label", tf("propRemove", { key: row.key }));
    del.appendChild(crossIcon());
    ownPointer(del);
    del.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      set(row.key, null);
    });
    rowEl.appendChild(del);
  };

  const footer = (): HTMLElement => {
    const foot = document.createElement("div");
    foot.className = "cm-s-props__foot";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "cm-s-props__addprop";
    add.textContent = t("propAdd");
    ownPointer(add);
    add.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openAddForm(foot, add, set);
    });
    foot.appendChild(add);
    return foot;
  };

  return { editRow, footer };
}

/** `key:` + `value:` on one line, because adding a property is one thought.
 *  Enter in the name box moves to the value; Enter in the value writes; Esc
 *  from either puts the "Add property" button back. */
function openAddForm(
  foot: HTMLElement,
  add: HTMLElement,
  set: (key: string, value: PropertyValue | null) => void,
): void {
  const form = document.createElement("div");
  form.className = "cm-s-props__form";
  const keyBox = input("", "text");
  keyBox.classList.add("cm-s-props__input--key");
  keyBox.placeholder = t("propKey");
  const valueBox = input("", "text");
  valueBox.placeholder = t("propValue");

  const close = (): void => foot.replaceChildren(add);
  const commit = (): void => {
    const key = keyBox.value.trim();
    close();
    if (key !== "") set(key, { kind: "text", text: valueBox.value.trim() });
  };
  ownKeys(keyBox, () => valueBox.focus(), close);
  ownKeys(valueBox, commit, close);
  // Leaving the pair entirely closes it; moving BETWEEN the two boxes does not.
  const leave = (): void => {
    window.setTimeout(() => {
      if (!form.contains(document.activeElement)) close();
    }, 0);
  };
  keyBox.addEventListener("blur", leave);
  valueBox.addEventListener("blur", leave);

  form.append(keyBox, valueBox);
  foot.replaceChildren(form);
  keyBox.focus();
}

/** A scalar: the printed value becomes a button that becomes an input. A DATE
 *  gets the platform's own picker — a calendar is the one control nobody has
 *  to be taught, and the writer spells the result unquoted so YAML reads it
 *  back as a date. */
function scalarRow(
  row: PropRow,
  valueEl: HTMLElement,
  kind: "text" | "date",
  set: (key: string, value: PropertyValue | null) => void,
): void {
  const text = row.values[0] ?? "";
  const draw = (): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = text === "" ? "cm-s-props__edit cm-s-props__edit--empty" : "cm-s-props__edit";
    button.title = t("propValue");
    const label = document.createElement("bdi");
    label.textContent = text === "" ? t("propEmpty") : text;
    button.appendChild(label);
    ownPointer(button);
    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      edit(valueEl, input(text, kind), draw, (next) => {
        if (next === text) return;
        if (next === "") set(row.key, null);
        else set(row.key, kind === "date" ? { kind: "date", date: next } : { kind: "text", text: next });
      });
    });
    valueEl.replaceChildren(button);
  };
  draw();
}

/** A boolean: a real checkbox, ticked or not, with the word beside it. The
 *  word stays because frontmatter is a FILE — a reader comparing the card to
 *  `git diff` needs to see the same token in both. */
function boolRow(
  row: PropRow,
  valueEl: HTMLElement,
  set: (key: string, value: PropertyValue | null) => void,
): void {
  const on = row.raw === "true";
  const label = document.createElement("label");
  label.className = "cm-s-props__bool";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "cm-s-props__check";
  box.checked = on;
  const word = document.createElement("span");
  // NOT COPY, AND THEREFORE NOT TRANSLATED: this is the token the FILE holds,
  // and `String(boolean)` is the same two spellings YAML accepts. A reader
  // comparing the card against `git diff` — or against the raw YAML one click
  // away — has to see the same characters in both places, in either language.
  word.textContent = String(on);
  ownPointer(label);
  box.addEventListener("change", () => set(row.key, { kind: "bool", bool: box.checked }));
  label.append(box, word);
  valueEl.replaceChildren(label);
}

/** A list: one chip per value, each with its own ×, and a `+` that opens an
 *  input at the end of the run.
 *
 *  THE CHIPS ARE THE ONES THE CARD ALREADY DREW. A `tags:` row's values are
 *  clickable search pills (with their own direction isolate, their own label
 *  mapping and their own canonical `data-tag`), and rebuilding them here would
 *  fork all three. So the existing elements are wrapped, not replaced: the pill
 *  still searches when clicked, and the × beside it removes the value. */
function listRow(
  row: PropRow,
  valueEl: HTMLElement,
  set: (key: string, value: PropertyValue | null) => void,
): void {
  const drawn = Array.from(valueEl.children) as HTMLElement[];
  const chips = document.createDocumentFragment();
  row.values.forEach((value, i) => {
    const chip = document.createElement("span");
    chip.className = "cm-s-props__chip";
    const shown = drawn[i];
    if (shown) chip.appendChild(shown);
    else {
      const bdi = document.createElement("bdi");
      bdi.textContent = value;
      chip.appendChild(bdi);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.className = "cm-s-props__chipx";
    x.title = tf("propRemoveValue", { value });
    x.setAttribute("aria-label", tf("propRemoveValue", { value }));
    x.appendChild(crossIcon());
    ownPointer(x);
    x.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      set(row.key, { kind: "list", items: row.values.filter((_, j) => j !== i) });
    });
    chip.appendChild(x);
    chips.appendChild(chip);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.className = "cm-s-props__addvalue";
  add.title = t("propAddValue");
  add.setAttribute("aria-label", t("propAddValue"));
  add.textContent = "+";
  ownPointer(add);
  const holder = document.createElement("span");
  holder.className = "cm-s-props__adder";
  holder.appendChild(add);
  add.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const box = input("", "text");
    box.classList.add("cm-s-props__input--chip");
    box.placeholder = t("propAddValue");
    edit(holder, box, () => holder.replaceChildren(add), (next) => {
      if (next === "" || row.values.includes(next)) return;
      set(row.key, { kind: "list", items: [...row.values, next] });
    });
  });

  valueEl.replaceChildren(chips, holder);
}

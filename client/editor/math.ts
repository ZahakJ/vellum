// KaTeX math for live preview. Inline $x$ renders as an inline widget when the
// cursor is off its line; $$ blocks (single- or multi-line) render as centered
// display-math block widgets when the cursor is outside the block. KaTeX CSS is
// bundled from node_modules (katex/dist/katex.min.css imported in
// livePreview.ts) — no CDN.

import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType, type EditorView } from "@codemirror/view";
import { getKatex, loadKatex } from "../katex.ts";

function renderTex(
  el: HTMLElement,
  tex: string,
  display: boolean,
  onLateRender?: () => void,
): void {
  const paint = (k: NonNullable<ReturnType<typeof getKatex>>): void => {
    try {
      k.render(tex, el, {
        throwOnError: false,
        displayMode: display,
        output: "htmlAndMathml",
      });
    } catch {
      el.textContent = tex;
    }
  };
  const loaded = getKatex();
  if (loaded) {
    paint(loaded);
    return;
  }
  // KaTeX not in yet: show the source, swap in the rendered math on arrival.
  el.textContent = tex;
  el.classList.add("cm-s-math-pending");
  void loadKatex().then((k) => {
    if (!el.isConnected) return; // widget was discarded meanwhile
    el.classList.remove("cm-s-math-pending");
    paint(k);
    onLateRender?.();
  });
}

class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  override eq(other: InlineMathWidget): boolean {
    return other.tex === this.tex;
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-s-math";
    renderTex(span, this.tex, false, () => view.requestMeasure());
    return span;
  }
  override ignoreEvent(): boolean {
    return false; // click puts the cursor at the math source
  }
}

class BlockMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly pos: number, // start of the $$ block, for click-to-edit
  ) {
    super();
  }
  override eq(other: BlockMathWidget): boolean {
    return other.tex === this.tex;
  }
  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-s-math-block";
    renderTex(div, this.tex, true, () => view.requestMeasure());
    div.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      view.dispatch({
        selection: { anchor: Math.min(this.pos, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return div;
  }
  override ignoreEvent(): boolean {
    return true; // we handle the click ourselves
  }
}

interface Span {
  from: number;
  to: number;
}

/**
 * Scan one line's text for $inline$ math. Pandoc-ish rules: no space just
 * inside the delimiters, closing $ not followed by a digit, `\$` escapes.
 * Matches overlapping `blocked` spans (code, embeds, comments) are skipped.
 * Returns the spans it claimed.
 */
export function inlineMathDecos(
  lineText: string,
  lineFrom: number,
  lineActive: boolean,
  blocked: (from: number, to: number) => boolean,
  decos: Range<Decoration>[],
): Span[] {
  const claimed: Span[] = [];
  const re = /\$([^$\n]+?)\$/g;
  for (let m = re.exec(lineText); m; m = re.exec(lineText)) {
    const tex = m[1];
    const prev = m.index > 0 ? lineText[m.index - 1] : "";
    const next = lineText[m.index + m[0].length] ?? "";
    if (
      prev === "$" ||
      prev === "\\" ||
      next === "$" ||
      /\d/.test(next) ||
      /^\s/.test(tex) ||
      /\s$/.test(tex)
    ) {
      re.lastIndex = m.index + 1;
      continue;
    }
    const from = lineFrom + m.index;
    const to = from + m[0].length;
    if (blocked(from, to)) continue;
    if (lineActive) {
      decos.push(Decoration.mark({ class: "cm-s-math-src" }).range(from, to));
    } else {
      decos.push(
        Decoration.replace({ widget: new InlineMathWidget(tex) }).range(from, to),
      );
    }
    claimed.push({ from, to });
  }
  return claimed;
}

/**
 * Find $$ display blocks in the whole document (StateField side — block
 * widgets cannot come from a ViewPlugin). A block either sits on one line
 * (`$$x^2$$`) or opens with a line whose content starts with `$$` and closes
 * at the next line ending with `$$`.
 */
export function blockMathDecos(
  state: EditorState,
  activeLines: Set<number>,
  isCode: (pos: number) => boolean,
  decos: Range<Decoration>[],
): void {
  const doc = state.doc;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const t = line.text.trim();
    if (!t.startsWith("$$") || isCode(line.from)) continue;

    let lastN = n;
    let tex: string;
    if (t.length > 4 && t.endsWith("$$")) {
      tex = t.slice(2, -2).trim();
    } else {
      let closing = -1;
      for (let k = n + 1; k <= doc.lines; k++) {
        const kt = doc.line(k).text.trim();
        if (kt.endsWith("$$")) {
          closing = k;
          break;
        }
      }
      if (closing < 0) continue; // unterminated — leave as source
      const parts: string[] = [t.slice(2)];
      for (let k = n + 1; k < closing; k++) parts.push(doc.line(k).text);
      const lastText = doc.line(closing).text.trim();
      parts.push(lastText.slice(0, -2));
      tex = parts.join("\n").trim();
      lastN = closing;
    }
    if (tex === "") {
      n = lastN;
      continue;
    }

    let active = false;
    for (let k = n; k <= lastN; k++) {
      if (activeLines.has(k)) {
        active = true;
        break;
      }
    }
    if (active) {
      for (let k = n; k <= lastN; k++) {
        decos.push(
          Decoration.line({ class: "cm-s-math-srcline" }).range(doc.line(k).from),
        );
      }
    } else {
      decos.push(
        Decoration.replace({
          widget: new BlockMathWidget(tex, line.from + 2),
          block: true,
        }).range(line.from, doc.line(lastN).to),
      );
    }
    n = lastN;
  }
}

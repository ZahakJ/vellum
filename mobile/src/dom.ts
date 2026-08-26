/** Four lines of DOM plumbing, so the two screens below can be written as
 *  structure instead of as string concatenation. Text always arrives through
 *  `textContent`: a site name and a host both come off the network, and an
 *  `innerHTML` here would be an injection hole in the one screen that exists to
 *  be careful about which server it trusts. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) node.className = className;
  Object.assign(node, rest);
  for (const child of children) node.append(child);
  return node;
}

/** The one place raw markup is allowed: inline icons, authored here, never
 *  interpolated. */
export function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const d = document.createElementNS("http://www.w3.org/2000/svg", "path");
  d.setAttribute("d", path);
  svg.append(d);
  return svg;
}

/**
 * The four-pointed star, as a path rather than the character ✦.
 *
 * The web client can type the glyph because a browser has a hundred fonts to
 * find it in. An Android WebView has whatever the phone shipped: U+2726 lands in
 * Noto Sans Symbols on one device, in an emoji font on another, and in a
 * tofu box on a stripped OEM build. This is the SAME path as the launcher icon
 * and the splash (icons/make-icons.mjs), so the mark on the home screen, the
 * mark on the splash and the mark on this screen are one shape.
 */
const STAR_PATH = "M12,0.6 Q12.65,11.35 23.4,12 Q12.65,12.65 12,23.4 Q11.35,12.65 0.6,12 Q11.35,11.35 12,0.6 Z";

function star(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "star");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", STAR_PATH);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

/** `✦ Vellum`, the one mark this app has. */
export function wordmark(name: string, extraClass = ""): HTMLElement {
  return el("h1", { class: `wordmark ${extraClass}`.trim() }, star(), el("span", { textContent: name }));
}

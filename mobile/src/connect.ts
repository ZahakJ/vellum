import { el, icon, wordmark } from "./dom.ts";
import { t } from "./i18n.ts";
import { VellumNative } from "./native.ts";
import { normalizeServerUrl, probe, type MeData } from "./server.ts";
import { forgetServer, lastServer, loadServers, rememberServer, type SavedServer } from "./store.ts";

/**
 * The connection screen: the only screen this app owns.
 *
 * Everything past it is the owner's own instance, rendered by the owner's own
 * server, and the shell's job there is to be invisible. So this screen carries
 * the whole identity — it is the app's face, and it gets one chance.
 */

const TRASH = "M2.5 4h11M6.5 4V2.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V4M4 4l.6 8.4a1 1 0 0 0 1 .93h4.8a1 1 0 0 0 1-.93L12 4";

export interface ConnectOptions {
  /** True when the owner arrived here by backing OUT of a connected instance.
   *  Auto-connect is suppressed, because reconnecting to the thing someone just
   *  left is a trap they cannot escape by pressing back again. */
  pick: boolean;
}

export async function mountConnect(root: HTMLElement, options: ConnectOptions): Promise<void> {
  const last = await lastServer();
  if (!options.pick && last) {
    await autoConnect(root, last);
    return;
  }
  await renderForm(root, { prefill: last ?? "" });
}

/** The remembered instance, entered without a tap. Failure falls through to the
 *  full screen carrying the reason, so a server that moved is a sentence rather
 *  than a hang. */
async function autoConnect(root: HTMLElement, url: string): Promise<void> {
  const parsed = normalizeServerUrl(url);
  if (!parsed.ok) {
    await renderForm(root, { prefill: url, error: parsed.message });
    return;
  }

  const status = el("p", { class: "status", textContent: t.connectingTo(parsed.host) });
  const escape = el("button", {
    class: "btn-link",
    type: "button",
    textContent: t.chooseAnother,
    onclick: () => void renderForm(root, { prefill: url }),
  });
  root.replaceChildren(
    el("div", { class: "sheet" }, el("div", { class: "waiting" }, wordmark(t.wordmark), status, escape)),
  );

  const result = await probe(parsed.url, parsed.host);
  if (!result.ok) {
    await renderForm(root, { prefill: url, error: result.message });
    return;
  }
  await enter(parsed.url, parsed.host, result.me, status);
}

interface FormOptions {
  prefill?: string;
  error?: string;
}

async function renderForm(root: HTMLElement, options: FormOptions = {}): Promise<void> {
  const input = el("input", {
    type: "text",
    id: "server",
    value: options.prefill ?? "",
    placeholder: t.serverPlaceholder,
    autocapitalize: "none",
    spellcheck: false,
    enterKeyHint: "go",
  });
  input.setAttribute("inputmode", "url");
  // `autocomplete` is set through the attribute because the DOM property is
  // typed to the HTML autofill token list, and "url" is a keyboard hint here
  // rather than an autofill field name.
  input.setAttribute("autocomplete", "url");
  input.setAttribute("autocorrect", "off");

  const submit = el("button", { class: "btn-primary", type: "submit", textContent: t.connect });

  // One live region for every answer this screen gives, so a reader using
  // TalkBack hears the failure without hunting for where it was printed.
  const message = el("p", { class: "message", hidden: true });
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");

  const setMessage = (text: string, kind: "error" | "note" | "good" = "error"): void => {
    message.className = kind === "error" ? "message" : `message ${kind}`;
    message.textContent = text;
    message.hidden = false;
  };
  if (options.error) setMessage(options.error);

  const form = el(
    "form",
    {},
    el("div", {}, el("label", { htmlFor: "server", textContent: t.serverLabel }), input),
    el("p", { class: "hint", textContent: t.serverHint }),
    message,
    submit,
  );

  const sheet = el(
    "div",
    { class: "sheet" },
    el("div", { class: "masthead" }, wordmark(t.wordmark), el("p", { class: "lede", textContent: t.connectLede })),
    form,
  );

  const servers = await loadServers();
  if (servers.length > 0) sheet.append(savedList(servers, root));

  root.replaceChildren(sheet);

  form.onsubmit = (event) => {
    event.preventDefault();
    void attempt();
  };

  async function attempt(): Promise<void> {
    const parsed = normalizeServerUrl(input.value);
    if (!parsed.ok) {
      setMessage(parsed.message);
      input.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = t.connecting;
    message.hidden = true;

    const result = await probe(parsed.url, parsed.host);
    if (!result.ok) {
      submit.disabled = false;
      submit.textContent = t.connect;
      setMessage(result.message);
      return;
    }
    await enter(parsed.url, parsed.host, result.me, null, (text) => setMessage(text, "note"));
  }
}

function savedList(servers: SavedServer[], root: HTMLElement): HTMLElement {
  const list = el("ul", {});
  for (const server of servers) {
    const host = hostOf(server.url);
    const open = el("button", {
      class: "saved-open",
      type: "button",
      onclick: () => void autoConnect(root, server.url),
    });
    open.append(el("span", { class: "name", textContent: server.name }));
    // An instance with no `siteName` is remembered under its own host, and
    // printing that host again underneath would be a subtitle that says the
    // title.
    if (server.name !== host) open.append(el("span", { class: "host", textContent: host }));
    const forget = el("button", {
      class: "saved-forget",
      type: "button",
      title: t.forgetOne(host),
      onclick: async () => {
        await forgetServer(server.url);
        await renderForm(root);
      },
    });
    forget.setAttribute("aria-label", t.forgetOne(host));
    forget.append(icon(TRASH));
    list.append(el("li", {}, open, forget));
  }
  return el("section", { class: "saved" }, el("h2", { textContent: t.savedTitle }), list);
}

/** Remember, then hand the WebView over to the instance. Nothing after this
 *  line is our screen. */
async function enter(
  url: string,
  host: string,
  me: MeData,
  status: HTMLElement | null,
  note?: (text: string) => void,
): Promise<void> {
  await rememberServer({ url, name: me.siteName?.trim() || host });
  // A password prompt is about to appear from a page the owner did not write.
  // Saying so first is the difference between "signed out" and "something is
  // wrong with my server".
  if (me.protected && !me.admin) {
    if (status) status.textContent = t.signInNote;
    else note?.(t.signInNote);
  }
  await VellumNative.connect({ url });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

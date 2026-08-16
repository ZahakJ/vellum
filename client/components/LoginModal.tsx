// Minimal sign-in modal: one serif password field, gold focus ring, shake on a
// rejected password. Success flips the store's admin flag and the whole app
// re-renders into edit mode live — no reload.

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useDialog } from "../a11y.ts";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";

export default function LoginModal() {
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const errorId = useId();
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const siteName = useStore((s) => s.siteName);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tab stays inside the dialog, Escape leaves it, and closing puts focus
  // back on the control that opened it (the status bar's "Sign in", the
  // palette row, the locked-vault button — all of which are still there).
  useDialog(formRef, {
    initialFocus: () => inputRef.current,
    onEscape: () => setLoginOpen(false),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    useStore
      .getState()
      .login(password)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t("signInFailed"));
        setShaking(true);
        setPassword("");
        setBusy(false);
        inputRef.current?.focus();
      });
  };

  return (
    <div className="s-login-overlay" onMouseDown={() => setLoginOpen(false)}>
      <form
        ref={formRef}
        className={`s-login${shaking ? " s-login--shake" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        onAnimationEnd={() => setShaking(false)}
        onSubmit={submit}
      >
        <div className="s-login__glyph" aria-hidden="true">✦</div>
        <h2 className="s-login__title" id={titleId}>{tf("signInTo", { site: siteName })}</h2>
        <p className="s-login__hint">{t("signInHint")}</p>
        <input
          ref={inputRef}
          className="s-login__input"
          type="password"
          value={password}
          placeholder={t("password")}
          // The field's name and its rejection both have to reach a screen
          // reader: a placeholder is not a label, and a red line of text
          // sitting next to an input is not attached to it.
          aria-label={t("password")}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          autoComplete="current-password"
          spellCheck={false}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        <p className="s-login__error" id={errorId} role="alert">
          {error ?? " "}
        </p>
        <div className="s-login__actions">
          <button
            type="button"
            className="s-btn s-login__cancel"
            onClick={() => setLoginOpen(false)}
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="s-btn s-btn--accent"
            disabled={busy || !password}
          >
            {busy ? t("signingIn") : t("signIn")}
          </button>
        </div>
      </form>
    </div>
  );
}

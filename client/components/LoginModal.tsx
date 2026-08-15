// Minimal sign-in modal: one serif password field, gold focus ring, shake on a
// rejected password. Success flips the store's admin flag and the whole app
// re-renders into edit mode live — no reload.

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";

export default function LoginModal() {
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const siteName = useStore((s) => s.siteName);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLoginOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setLoginOpen]);

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
        className={`s-login${shaking ? " s-login--shake" : ""}`}
        role="dialog"
        aria-label={t("signIn")}
        onMouseDown={(e) => e.stopPropagation()}
        onAnimationEnd={() => setShaking(false)}
        onSubmit={submit}
      >
        <div className="s-login__glyph" aria-hidden="true">✦</div>
        <h2 className="s-login__title">{tf("signInTo", { site: siteName })}</h2>
        <p className="s-login__hint">{t("signInHint")}</p>
        <input
          ref={inputRef}
          className="s-login__input"
          type="password"
          value={password}
          placeholder={t("password")}
          autoComplete="current-password"
          spellCheck={false}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        <p className="s-login__error" role="alert">
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

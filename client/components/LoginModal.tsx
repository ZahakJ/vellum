// Minimal sign-in modal: one serif password field, gold focus ring, shake on a
// rejected password. Success flips the store's admin flag and the whole app
// re-renders into edit mode live — no reload.

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useStore } from "../state.ts";

export default function LoginModal() {
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const siteName = useStore((s) => s.siteName);
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
        setError(err instanceof Error ? err.message : "Sign-in failed");
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
        aria-label="Sign in"
        onMouseDown={(e) => e.stopPropagation()}
        onAnimationEnd={() => setShaking(false)}
        onSubmit={submit}
      >
        <div className="s-login__glyph" aria-hidden="true">✦</div>
        <h2 className="s-login__title">Sign in to {siteName}</h2>
        <p className="s-login__hint">Admin password unlocks editing.</p>
        <input
          ref={inputRef}
          className="s-login__input"
          type="password"
          value={password}
          placeholder="Password"
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
            Cancel
          </button>
          <button
            type="submit"
            className="s-btn s-btn--accent"
            disabled={busy || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 font-mono text-[12px] font-semibold
                 tracking-[0.12em] text-base transition hover:opacity-90
                 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "VERIFYING…" : "AUTHENTICATE"}
    </button>
  );
}

export default function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="mt-8">
      <label className="block">
        <span className="mz-label">Identity</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          placeholder="name@mizan.gov.ae"
          className="mz-field mt-2 w-full px-3.5 py-2.5 text-[14px] placeholder:text-ink-faint"
        />
      </label>

      <label className="mt-5 block">
        <span className="mz-label">Passphrase</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className="mz-field mt-2 w-full px-3.5 py-2.5 text-[14px] placeholder:text-ink-faint"
        />
      </label>

      {state.error && (
        <p
          role="alert"
          className="mz-anim-in mt-5 rounded-lg border border-deny/40 bg-deny-soft px-3.5 py-2.5 text-[12.5px] text-deny"
        >
          {state.error}
        </p>
      )}

      <Submit />
    </form>
  );
}

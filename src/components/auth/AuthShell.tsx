import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth-bg min-h-screen w-full flex items-center justify-center px-4 py-10 text-slate-900">
      <div className="auth-blob h-72 w-72 bg-sky-300 left-[-4rem] top-[-4rem]" />
      <div
        className="auth-blob h-80 w-80 bg-blue-300 right-[-6rem] top-1/3"
        style={{ animationDelay: "3s" }}
      />
      <div
        className="auth-blob h-64 w-64 bg-cyan-300 left-1/3 bottom-[-4rem]"
        style={{ animationDelay: "6s" }}
      />

      <div className="auth-fade-up relative z-10 w-full max-w-md rounded-2xl border border-white/60 bg-white/80 p-8 shadow-[0_25px_60px_-20px_rgba(56,189,248,0.35)] backdrop-blur-xl">
        <Link to="/" className="mb-6 flex items-center gap-2 text-sky-600">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-600">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">MF SMC Trader</span>
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

        <div className="mt-6 flex rounded-lg bg-sky-50 p-1 text-sm font-medium">
          <Link
            to="/login"
            className="flex-1 rounded-md px-3 py-2 text-center transition-colors text-slate-500 hover:text-sky-700 [&.active]:bg-white [&.active]:text-sky-700 [&.active]:shadow-sm"
            activeProps={{ className: "active" }}
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="flex-1 rounded-md px-3 py-2 text-center transition-colors text-slate-500 hover:text-sky-700 [&.active]:bg-white [&.active]:text-sky-700 [&.active]:shadow-sm"
            activeProps={{ className: "active" }}
          >
            Register
          </Link>
        </div>

        <div className="mt-6 auth-tab-switch">{children}</div>

        <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>
      </div>
    </div>
  );
}

export function fieldClasses(hasError: boolean) {
  return [
    "w-full rounded-lg border bg-white/90 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition",
    "focus:border-sky-400 focus:ring-4 focus:ring-sky-100",
    hasError ? "border-rose-400 field-shake" : "border-slate-200",
  ].join(" ");
}

export function PrimaryButton({
  children,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={
        "btn-glow w-full rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 " +
        (props.className ?? "")
      }
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span>{children}</span>
    </button>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { TrendingUp, BarChart2, Shield, Zap, ChevronDown, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MF SMC Trader — Professional Forex SMC Analysis" },
      {
        name: "description",
        content:
          "Professional forex trading terminal with live market data, Smart Money Concept analysis, and real-time candlestick charts.",
      },
    ],
  }),
  component: LandingPage,
});

/* ─── Animated candlestick SVG illustration ────────────────────────────── */
function CandlestickIllustration() {
  return (
    <svg
      viewBox="0 0 320 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-sm drop-shadow-2xl"
      style={{ filter: "drop-shadow(0 0 32px rgba(37,99,235,0.35))" }}
    >
      {/* Grid lines */}
      {[40, 80, 120, 160].map((y) => (
        <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="rgba(37,99,235,0.15)" strokeWidth="1" />
      ))}
      {[40, 80, 120, 160, 200, 240, 280].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="200" stroke="rgba(37,99,235,0.10)" strokeWidth="1" />
      ))}

      {/* Area fill under line */}
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>

      {/* Trend line area */}
      <path
        d="M10,155 L50,140 L90,125 L130,105 L170,95 L210,80 L250,65 L290,50 L310,40 L310,200 L10,200 Z"
        fill="url(#areaGrad)"
      />
      <path
        d="M10,155 L50,140 L90,125 L130,105 L170,95 L210,80 L250,65 L290,50 L310,40"
        stroke="url(#lineGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bullish candles (teal) */}
      {[
        { x: 30, body: [130, 148], wick: [125, 155] },
        { x: 110, body: [98, 115], wick: [92, 122] },
        { x: 190, body: [74, 92], wick: [68, 98] },
        { x: 270, body: [48, 65], wick: [42, 72] },
      ].map(({ x, body, wick }) => (
        <g key={x}>
          <line x1={x} y1={wick[0]} x2={x} y2={wick[1]} stroke="#10B981" strokeWidth="1.5" />
          <rect x={x - 7} y={body[0]} width="14" height={body[1] - body[0]} rx="2" fill="#10B981" fillOpacity="0.9" />
        </g>
      ))}

      {/* Bearish candles (red) */}
      {[
        { x: 70, body: [128, 143], wick: [122, 150] },
        { x: 150, body: [90, 104], wick: [85, 112] },
        { x: 230, body: [62, 76], wick: [56, 82] },
      ].map(({ x, body, wick }) => (
        <g key={x}>
          <line x1={x} y1={wick[0]} x2={x} y2={wick[1]} stroke="#EF4444" strokeWidth="1.5" />
          <rect x={x - 7} y={body[0]} width="14" height={body[1] - body[0]} rx="2" fill="#EF4444" fillOpacity="0.85" />
        </g>
      ))}

      {/* SMC zone highlight */}
      <rect x="155" y="86" width="85" height="20" rx="2" fill="#2563EB" fillOpacity="0.15" stroke="#2563EB" strokeWidth="0.75" strokeOpacity="0.5" />
      <text x="160" y="100" fill="#60A5FA" fontSize="8" fontFamily="monospace" fontWeight="600">OB</text>

      {/* Live price line */}
      <line x1="0" y1="48" x2="300" y2="48" stroke="#2563EB" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.7" />
      <rect x="285" y="41" width="35" height="14" rx="3" fill="#2563EB" />
      <text x="302" y="51" fill="white" fontSize="7.5" fontFamily="monospace" textAnchor="middle" fontWeight="700">LIVE</text>
    </svg>
  );
}

/* ─── Floating background particles ────────────────────────────────────── */
function FloatingParticles() {
  const particles = [
    { size: 3, top: "15%", left: "8%",  delay: "0s",   duration: "7s"  },
    { size: 2, top: "72%", left: "5%",  delay: "1.2s", duration: "9s"  },
    { size: 4, top: "38%", left: "92%", delay: "0.5s", duration: "8s"  },
    { size: 2, top: "85%", left: "88%", delay: "2s",   duration: "10s" },
    { size: 3, top: "55%", left: "50%", delay: "1.5s", duration: "6s"  },
    { size: 2, top: "22%", left: "70%", delay: "3s",   duration: "11s" },
    { size: 3, top: "65%", left: "30%", delay: "0.8s", duration: "8s"  },
    { size: 2, top: "10%", left: "45%", delay: "2.5s", duration: "9s"  },
    { size: 4, top: "45%", left: "18%", delay: "1s",   duration: "7s"  },
    { size: 2, top: "90%", left: "55%", delay: "3.5s", duration: "12s" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-blue-400"
          style={{
            width: p.size,
            height: p.size,
            top: p.top,
            left: p.left,
            opacity: 0.35,
            animation: `particleFloat ${p.duration} ease-in-out infinite`,
            animationDelay: p.delay,
          }}
        />
      ))}
      {/* Animated grid lines overlay */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#60A5FA" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>
  );
}

/* ─── Scroll-reveal hook ────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}

/* ─── Feature card ─────────────────────────────────────────────────────── */
function FeatureCard({
  icon, title, desc, delay,
}: { icon: React.ReactNode; title: string; desc: string; delay: string }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      style={{
        transitionDelay: delay,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
      }}
      className="flex flex-col items-start gap-4 rounded-2xl border border-blue-900/40 bg-[#0F2448]/80 p-6 backdrop-blur-sm"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
        {icon}
      </div>
      <div>
        <h3 className="mb-1 text-base font-semibold text-white">{title}</h3>
        <p className="text-sm leading-relaxed text-blue-200/70">{desc}</p>
      </div>
    </div>
  );
}

/* ─── Landing page ──────────────────────────────────────────────────────── */
function LandingPage() {
  const authRef = useRef<HTMLDivElement>(null);

  function scrollToAuth() {
    authRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const { ref: featuresRef, visible: featuresVisible } = useReveal();
  const { ref: authRevealRef, visible: authRevealVisible } = useReveal();

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>

      {/* ══════════════════════════════════════════════════════
          HERO SECTION — dark navy, full screen
      ════════════════════════════════════════════════════════ */}
      <section
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center"
        style={{
          background: "linear-gradient(160deg, #071325 0%, #0B1D3A 45%, #0D2352 75%, #091429 100%)",
        }}
      >
        <FloatingParticles />

        {/* Glow blobs */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/4 -translate-x-1/2"
          style={{
            width: 600,
            height: 400,
            background: "radial-gradient(ellipse, rgba(37,99,235,0.18) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        <div
          className="pointer-events-none absolute bottom-1/4 right-1/4"
          style={{
            width: 300,
            height: 250,
            background: "radial-gradient(ellipse, rgba(96,165,250,0.12) 0%, transparent 70%)",
            filter: "blur(32px)",
          }}
        />

        {/* Nav bar */}
        <nav
          className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-6 py-5"
          style={{ animation: "heroReveal 0.6s cubic-bezier(0.22,1,0.36,1) both" }}
        >
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="MF SMC Logo" className="h-9 w-9 rounded-xl object-cover shadow-lg" />
            <span className="text-base font-bold tracking-tight text-white">MF SMC Trader</span>
          </div>
          <Link
            to="/login"
            className="rounded-xl border border-blue-500/40 bg-blue-600/15 px-4 py-2 text-sm font-semibold text-blue-300 backdrop-blur-sm transition-all hover:bg-blue-600/30 hover:text-white hover:border-blue-400/60"
          >
            Sign in
          </Link>
        </nav>

        {/* Hero content */}
        <div
          className="relative z-10 flex max-w-4xl flex-col items-center gap-8"
          style={{ animation: "heroReveal 0.75s 0.15s cubic-bezier(0.22,1,0.36,1) both" }}
        >
          {/* Badge */}
          <div className="flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-600/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-blue-300 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" style={{ animation: "livePulse 2s infinite" }} />
            Live Market Data · SMC Analysis
          </div>

          {/* Headline */}
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl">
            Trade Smarter with{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(135deg, #60A5FA 0%, #2563EB 50%, #93C5FD 100%)" }}
            >
              Smart Money
            </span>
          </h1>

          {/* Tagline */}
          <p className="max-w-xl text-lg leading-relaxed text-blue-200/80 sm:text-xl">
            Professional Forex terminal with real-time SMC zones, live candlestick charts, and institutional-grade analysis tools.
          </p>

          {/* Illustration */}
          <div
            className="w-full max-w-sm"
            style={{ animation: "heroReveal 0.9s 0.3s cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <CandlestickIllustration />
          </div>

          {/* CTA buttons */}
          <div
            className="flex flex-col items-center gap-3 sm:flex-row"
            style={{ animation: "heroReveal 0.75s 0.45s cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <button
              onClick={scrollToAuth}
              className="group flex items-center gap-2 rounded-2xl px-8 py-3.5 text-base font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-blue-500/30"
              style={{
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                boxShadow: "0 8px 28px rgba(37,99,235,0.35)",
              }}
            >
              Get Started Free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
            <Link
              to="/terminal"
              className="flex items-center gap-2 rounded-2xl border border-blue-500/30 bg-white/5 px-8 py-3.5 text-base font-semibold text-blue-200 backdrop-blur-sm transition-all hover:bg-white/10 hover:text-white"
            >
              <BarChart2 className="h-4 w-4" />
              Open Terminal
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <button
          onClick={scrollToAuth}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 text-blue-400/60 transition-colors hover:text-blue-300"
          aria-label="Scroll down"
        >
          <span className="text-[11px] font-medium uppercase tracking-widest">Scroll</span>
          <ChevronDown className="h-5 w-5" style={{ animation: "scrollBounce 1.8s ease-in-out infinite" }} />
        </button>
      </section>

      {/* ══════════════════════════════════════════════════════
          FEATURES SECTION — deep navy
      ════════════════════════════════════════════════════════ */}
      <section
        className="relative px-6 py-20"
        style={{ background: "linear-gradient(180deg, #091429 0%, #0B1D3A 100%)" }}
      >
        <div className="mx-auto max-w-5xl">
          {/* Section heading */}
          <div
            ref={featuresRef}
            style={{
              opacity: featuresVisible ? 1 : 0,
              transform: featuresVisible ? "translateY(0)" : "translateY(20px)",
              transition: "opacity 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1)",
            }}
            className="mb-14 text-center"
          >
            <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Everything you need to trade professionally
            </h2>
            <p className="mx-auto max-w-xl text-base text-blue-200/60">
              Built for traders who want institutional-grade analysis in a clean, fast platform.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<TrendingUp className="h-5 w-5" />}
              title="Live Market Data"
              desc="Real-time forex prices streamed directly to your terminal without delay."
              delay="0ms"
            />
            <FeatureCard
              icon={<BarChart2 className="h-5 w-5" />}
              title="SMC Zones"
              desc="Auto-detect Order Blocks, FVGs, BOS/CHoCH, and liquidity levels."
              delay="80ms"
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title="Custom Timeframes"
              desc="Pin any timeframe from 1 minute to monthly. Long-press to manage."
              delay="160ms"
            />
            <FeatureCard
              icon={<Shield className="h-5 w-5" />}
              title="Multi-Pair Watchlist"
              desc="Monitor 15+ forex pairs simultaneously with live price updates."
              delay="240ms"
            />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          AUTH SECTION — white / off-white background
      ════════════════════════════════════════════════════════ */}
      <section
        ref={authRef}
        className="relative px-6 py-24"
        style={{ background: "linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%)" }}
      >
        {/* Decorative top curve */}
        <div
          className="absolute left-0 right-0 top-0 h-12"
          style={{
            background: "#0B1D3A",
            clipPath: "ellipse(55% 100% at 50% 0%)",
          }}
        />

        <div
          ref={authRevealRef}
          style={{
            opacity: authRevealVisible ? 1 : 0,
            transform: authRevealVisible ? "translateY(0)" : "translateY(28px)",
            transition: "opacity 0.65s cubic-bezier(0.22,1,0.36,1), transform 0.65s cubic-bezier(0.22,1,0.36,1)",
          }}
          className="mx-auto max-w-2xl"
        >
          {/* Heading */}
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-[#0B1D3A] sm:text-4xl">
              Ready to start trading?
            </h2>
            <p className="text-base text-[#4A7FA5]">
              Create a free account or sign in to access the full terminal.
            </p>
          </div>

          {/* Auth cards */}
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Login card */}
            <Link
              to="/login"
              className="group flex flex-col items-center gap-5 rounded-3xl border-2 border-[#E0EFFF] bg-white p-8 shadow-sm transition-all hover:-translate-y-1 hover:border-blue-400 hover:shadow-xl"
              style={{ transitionDuration: "250ms" }}
            >
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110"
                style={{
                  background: "linear-gradient(135deg, #0B1D3A 0%, #162D52 100%)",
                  boxShadow: "0 8px 24px rgba(11,29,58,0.25)",
                  transitionDuration: "250ms",
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
              </div>
              <div className="text-center">
                <div className="mb-1 text-xl font-bold text-[#0B1D3A]">Sign In</div>
                <div className="text-sm text-[#4A7FA5]">Access your existing account</div>
              </div>
              <div
                className="w-full rounded-xl py-3 text-center text-sm font-bold text-white transition-all group-hover:shadow-lg"
                style={{
                  background: "linear-gradient(135deg, #0B1D3A 0%, #162D52 100%)",
                  transitionDuration: "250ms",
                }}
              >
                Login →
              </div>
            </Link>

            {/* Register card */}
            <Link
              to="/register"
              className="group flex flex-col items-center gap-5 rounded-3xl border-2 border-[#E0EFFF] bg-white p-8 shadow-sm transition-all hover:-translate-y-1 hover:border-blue-500 hover:shadow-xl"
              style={{ transitionDuration: "250ms" }}
            >
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110"
                style={{
                  background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                  boxShadow: "0 8px 24px rgba(37,99,235,0.3)",
                  transitionDuration: "250ms",
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div className="text-center">
                <div className="mb-1 text-xl font-bold text-[#0B1D3A]">Create Account</div>
                <div className="text-sm text-[#4A7FA5]">Start for free, no credit card</div>
              </div>
              <div
                className="w-full rounded-xl py-3 text-center text-sm font-bold text-white transition-all group-hover:shadow-lg"
                style={{
                  background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                  transitionDuration: "250ms",
                }}
              >
                Register →
              </div>
            </Link>
          </div>

          {/* Terminal shortcut */}
          <div className="mt-8 text-center">
            <Link
              to="/terminal"
              className="inline-flex items-center gap-2 text-sm font-medium text-[#4A7FA5] transition-colors hover:text-[#2563EB]"
            >
              <BarChart2 className="h-4 w-4" />
              Continue without account — open terminal
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════ */}
      <footer
        className="border-t border-[#1E3A6E] px-6 py-8 text-center"
        style={{ background: "#071325" }}
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          <img src="/logo.png" alt="MF SMC" className="h-6 w-6 rounded-lg object-cover opacity-80" />
          <span className="text-sm font-semibold text-white/60">MF SMC Trader</span>
        </div>
        <p className="text-xs text-blue-300/30">
          Professional Forex SMC Analysis Terminal · {new Date().getFullYear()}
        </p>
      </footer>

      {/* Global keyframes for this page */}
      <style>{`
        @keyframes heroReveal {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scrollBounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(6px); }
        }
        @keyframes particleFloat {
          0%, 100% { transform: translate(0, 0); }
          33%       { transform: translate(6px, -10px); }
          66%       { transform: translate(-5px, 5px); }
        }
        @keyframes livePulse {
          0%   { box-shadow: 0 0 0 0 rgba(52,211,153,0.55); }
          60%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </div>
  );
}

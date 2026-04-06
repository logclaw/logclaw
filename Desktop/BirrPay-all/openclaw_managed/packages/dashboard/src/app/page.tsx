"use client";

import Link from "next/link";
import {
  Bot,
  Mail,
  FolderOpen,
  Search,
  Clock,
  Brain,
  Home as HomeIcon,
  Code,
  Globe,
  Check,
  ArrowRight,
} from "lucide-react";

const STRIPE_LINK = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ?? "#";

/* ------------------------------------------------------------------ */
/*  Navbar                                                            */
/* ------------------------------------------------------------------ */
function Navbar() {
  return (
    <nav className="sticky top-0 z-50 h-14 border-b border-gray-200/50 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Bot size={18} />
          </span>
          <span className="text-base font-bold tracking-tight text-text-primary">
            ALITA
          </span>
        </Link>

        {/* Center nav links */}
        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#features"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Features
          </a>
          <a
            href="#integrations"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Integrations
          </a>
          <a
            href="#pricing"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Pricing
          </a>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Sign in
          </Link>
          <a
            href={STRIPE_LINK}
            className="inline-flex items-center rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition-all hover:bg-brand-700"
          >
            Get Started
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero                                                              */
/* ------------------------------------------------------------------ */
function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-32">
      {/* Background gradient blob */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2">
        <div className="h-[480px] w-[680px] rounded-full bg-brand-100/60 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-3xl text-center">
        <div className="mb-6 inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600">
          AI-Powered Assistant
        </div>

        <h1 className="text-5xl font-bold leading-[1.08] tracking-tight text-text-primary md:text-7xl">
          Your AI Chief&nbsp;of&nbsp;Staff
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-text-secondary">
          A personal AI assistant that reads your email, manages your calendar,
          automates your browser, and handles your admin across 73+
          integrations. Available 24/7 on WhatsApp, Slack, and every channel you
          use.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={STRIPE_LINK}
            className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-md transition-all hover:bg-brand-700 hover:shadow-lg"
          >
            Get Started &mdash; $149/mo
            <ArrowRight size={18} />
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-3 text-base font-semibold text-text-primary transition-all hover:border-gray-300 hover:shadow-sm"
          >
            See how it works
            <ArrowRight size={16} className="text-text-secondary" />
          </a>
        </div>

        {/* Trust line */}
        <p className="mt-14 text-sm text-text-tertiary">
          73+ integrations &middot; 15+ chat platforms &middot; 12+ AI models
          &middot; Setup in 2 min
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Capabilities                                                      */
/* ------------------------------------------------------------------ */
const CAPABILITIES: {
  icon: typeof Globe;
  title: string;
  desc: string;
  color: string;
  bg: string;
}[] = [
  {
    icon: Globe,
    title: "Browser Automation",
    desc: "Navigates websites, fills forms, extracts data, books appointments",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: Mail,
    title: "Email & Calendar",
    desc: "Triages inbox, drafts replies, manages schedule, sends calendar invites",
    color: "text-red-600",
    bg: "bg-red-50",
  },
  {
    icon: FolderOpen,
    title: "File & System Access",
    desc: "Reads/writes files, runs scripts, manages documents on your machine",
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  {
    icon: Search,
    title: "Web Research",
    desc: "Deep research on any topic with sources, comparisons, and summaries",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    icon: Clock,
    title: "Task Automation",
    desc: "Scheduled tasks, cron jobs, reminders, and background processes",
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    icon: Brain,
    title: "Persistent Memory",
    desc: "Remembers your preferences, contacts, and context across every conversation",
    color: "text-pink-600",
    bg: "bg-pink-50",
  },
  {
    icon: HomeIcon,
    title: "Smart Home & IoT",
    desc: "Controls Hue lights, Sonos, 8Sleep, Home Assistant, and more",
    color: "text-teal-600",
    bg: "bg-teal-50",
  },
  {
    icon: Code,
    title: "Code & Development",
    desc: "Writes code, creates PRs, runs tests, manages GitHub repos",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
];

function Capabilities() {
  return (
    <section id="features" className="px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
          Everything your assistant can do
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-text-secondary">
          Powered by OpenClaw &mdash; the most capable open-source AI agent
          platform
        </p>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-gray-200/60 bg-white p-6 transition-all hover:border-gray-300 hover:shadow-md"
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.bg} ${c.color}`}
              >
                <c.icon size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-text-primary">
                {c.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                {c.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Integrations                                                      */
/* ------------------------------------------------------------------ */
const INTEGRATION_CATEGORIES = [
  {
    label: "Chat",
    count: 15,
    items: [
      "WhatsApp",
      "Telegram",
      "Discord",
      "Slack",
      "Signal",
      "iMessage",
      "Teams",
      "Matrix",
    ],
    more: 7,
  },
  {
    label: "AI Models",
    count: 12,
    items: [
      "Claude",
      "GPT-4/5",
      "Gemini",
      "Grok",
      "DeepSeek",
      "Mistral",
      "Ollama",
    ],
    more: 5,
  },
  {
    label: "Productivity",
    count: 8,
    items: [
      "Notion",
      "Obsidian",
      "GitHub",
      "Trello",
      "Things 3",
      "Apple Notes",
    ],
    more: 2,
  },
  {
    label: "Smart Home",
    count: 3,
    items: ["Hue", "Sonos", "Home Assistant"],
    more: 0,
  },
  {
    label: "Social",
    count: 2,
    items: ["Twitter/X", "Email"],
    more: 0,
  },
  {
    label: "Media",
    count: 4,
    items: ["Spotify", "Image Gen", "Camera", "Shazam"],
    more: 0,
  },
];

function Integrations() {
  return (
    <section id="integrations" className="bg-white px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
          73+ integrations, one assistant
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-text-secondary">
          Connect the tools you already use. ALITA brings them all together.
        </p>

        <div className="mt-14 space-y-6">
          {INTEGRATION_CATEGORIES.map((cat) => (
            <div
              key={cat.label}
              className="rounded-xl border border-gray-200/60 bg-white p-5"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary">
                  {cat.label}
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-text-secondary">
                  {cat.count}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {cat.items.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-text-primary"
                  >
                    {item}
                  </span>
                ))}
                {cat.more > 0 && (
                  <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600">
                    +{cat.more} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Pricing                                                           */
/* ------------------------------------------------------------------ */
const PLAN_FEATURES = [
  "Your own private AI assistant",
  "73+ integrations (WhatsApp, Slack, Telegram...)",
  "18 pre-installed professional skills",
  "Browser automation & web research",
  "File & system access",
  "Persistent memory across sessions",
  "15+ messaging channels",
  "12+ AI models (Claude, GPT, Gemini...)",
  "Daily morning brief on WhatsApp",
  "Priority support",
];

function Pricing() {
  return (
    <section id="pricing" className="px-6 py-20 md:py-28">
      <div className="mx-auto max-w-lg text-center">
        <h2 className="text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
          Simple, transparent pricing
        </h2>
        <p className="mt-4 text-text-secondary">
          One plan. Everything included. No surprises.
        </p>

        <div className="mt-12 rounded-2xl border border-gray-200 bg-white p-8 text-left shadow-lg">
          <span className="text-sm font-semibold text-text-secondary">
            ALITA Solo
          </span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-5xl font-bold text-text-primary">$149</span>
            <span className="text-lg text-text-secondary">/month</span>
          </div>

          <hr className="my-6 border-gray-200" />

          <ul className="space-y-3">
            {PLAN_FEATURES.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2.5 text-sm text-text-primary"
              >
                <Check
                  size={16}
                  className="mt-0.5 shrink-0 text-green-600"
                />
                {f}
              </li>
            ))}
          </ul>

          <a
            href={STRIPE_LINK}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 py-3 text-base font-semibold text-white shadow-md transition-all hover:bg-brand-700 hover:shadow-lg"
          >
            Get Started
            <ArrowRight size={18} />
          </a>

          <p className="mt-4 text-center text-xs text-text-tertiary">
            No contracts. Cancel anytime. 7-day free trial.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                            */
/* ------------------------------------------------------------------ */
const FOOTER_LINKS = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "Integrations", href: "#integrations" },
    { label: "Pricing", href: "#pricing" },
    { label: "Dashboard", href: "/dashboard" },
  ],
  Company: [
    { label: "About", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Careers", href: "#" },
    { label: "Contact", href: "#" },
  ],
  Legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Security", href: "#" },
  ],
};

function Footer() {
  return (
    <footer className="border-t border-gray-200 px-6 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-4">
        {/* Brand */}
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Bot size={16} />
            </span>
            <span className="text-sm font-bold text-text-primary">ALITA</span>
          </div>
          <p className="mt-3 text-sm text-text-secondary">
            Your AI Chief of Staff
          </p>
          <p className="mt-4 text-sm text-text-tertiary">
            &copy; 2026 ALITA. All rights reserved.
          </p>
        </div>

        {/* Link columns */}
        {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
          <div key={heading}>
            <h4 className="text-sm font-semibold text-text-primary">
              {heading}
            </h4>
            <ul className="mt-3 space-y-2">
              {links.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith("/") ? (
                    <Link
                      href={link.href}
                      className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  return (
    <div className="min-h-screen scroll-smooth bg-surface-bg">
      <Navbar />
      <Hero />
      <Capabilities />
      <Integrations />
      <Pricing />
      <Footer />
    </div>
  );
}

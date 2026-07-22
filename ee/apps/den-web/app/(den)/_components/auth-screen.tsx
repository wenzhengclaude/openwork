"use client";

import { Cable, Cloud, Terminal, Workflow, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { isSamePathname } from "../_lib/client-route";
import { getMcpOAuthSelectOrganizationRoute } from "../_lib/mcp-oauth-route";
import { useDenFlow } from "../_providers/den-flow-provider";
import { AuthPanel } from "./auth-panel";

function RouteRow({
  icon: Icon,
  label,
  body,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  body: string;
  badge: string;
}) {
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[#d7e2de] bg-white/70 px-3.5 py-3 shadow-[0_10px_30px_-24px_rgba(1,22,39,0.35)]">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d9e7e1] bg-[#f4fbf7] text-[#09664f]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-semibold leading-tight text-[#011627]">{label}</p>
        <p className="m-0 mt-1 text-[12px] leading-snug text-[#667085]">{body}</p>
      </div>
      <span className="rounded-full border border-[#dbe7e2] bg-[#f8fbfa] px-2.5 py-1 text-[11px] font-semibold text-[#35544a]">
        {badge}
      </span>
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#d7e2de] bg-white/60 px-3.5 py-3">
      <p className="m-0 text-[11px] font-semibold uppercase leading-none text-[#6b7f78]">{label}</p>
      <p className="m-0 mt-2 text-[13px] font-semibold text-[#011627]">{value}</p>
    </div>
  );
}

function ControlRoomPanel() {
  return (
    <div className="relative hidden min-h-[220px] overflow-hidden bg-[#eef4f2] px-6 py-7 sm:px-8 sm:py-9 md:px-10 md:py-10 lg:block lg:min-h-[560px]">
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(#d7e2de 1px, transparent 1px), linear-gradient(90deg, #d7e2de 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(255,255,255,0.88),rgba(255,255,255,0.2)_48%,rgba(13,148,136,0.14))]" aria-hidden />
      <div className="absolute inset-x-8 top-8 h-px bg-[#011627]/10" aria-hidden />
      <div className="absolute inset-y-8 left-8 w-px bg-[#011627]/10" aria-hidden />

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/open-one-mark.svg" alt="Open One" className="h-9 w-9" />
            <div>
              <p className="m-0 text-[13px] font-semibold text-[#011627]">Open One Control</p>
              <p className="m-0 mt-0.5 text-[11px] font-medium text-[#667085]">Local-first command center</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#cfdcd7] bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-[#35544a] xl:flex">
            <span className="h-2 w-2 rounded-full bg-[#12b76a]" />
            Org scoped
          </div>
        </div>

        <div className="flex-[0.65]" aria-hidden />

        <div className="max-w-[34rem]">
          <p className="m-0 text-[11px] font-bold uppercase text-[#09664f]">Control plane for agent work</p>
          <h1 className="m-0 mt-3 max-w-[12ch] text-[2.25rem] font-semibold leading-[0.98] text-[#011627] sm:text-[2.6rem] md:text-[3.15rem]">
            Bring every agent under one roof.
          </h1>
          <p className="m-0 mt-4 max-w-[32rem] text-[14px] leading-6 text-[#4b5f59] sm:text-[15px] sm:leading-7">
            Route local files, team MCP connections, cloud workers, and model policy through one shared workspace.
          </p>
        </div>

        <div className="flex-[0.55]" aria-hidden />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_13.5rem]">
          <div className="rounded-[1.5rem] border border-[#cfdcd7] bg-[#f8fbfa]/80 p-3.5 shadow-[0_24px_50px_-38px_rgba(1,22,39,0.55)]">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <p className="m-0 text-[12px] font-semibold text-[#011627]">Workspace routes</p>
              <span className="rounded-full bg-[#011627] px-2.5 py-1 text-[11px] font-semibold text-white">Live</span>
            </div>
            <div className="grid gap-2.5">
              <RouteRow icon={Terminal} label="Desktop runtime" body="Keeps file work local." badge="Local" />
              <RouteRow icon={Cable} label="MCP connections" body="Shared by workspace policy." badge="Scoped" />
              <RouteRow icon={Cloud} label="Cloud workers" body="Run handoffs in the background." badge="Queued" />
            </div>
          </div>

          <div className="hidden rounded-[1.5rem] border border-[#cfdcd7] bg-[#011627] p-4 text-white shadow-[0_24px_50px_-38px_rgba(1,22,39,0.75)] xl:block">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-[#7dd3c7]" strokeWidth={1.8} />
              <p className="m-0 text-[12px] font-semibold">Policy lane</p>
            </div>
            <div className="mt-5 grid gap-4">
              {["Approve", "Connect", "Run"].map((step, index) => (
                <div key={step} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/10 text-[11px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <span className="text-[13px] font-medium text-white/80">{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-[12px] leading-5 text-white/70">
              Same workspace rules, whether work starts from the app or the cloud.
            </div>
          </div>
        </div>

        <div className="mt-auto pt-5">
          <div className="grid grid-cols-3 gap-2">
            <StatusTile label="Auth" value="SSO ready" />
            <StatusTile label="Tools" value="Per member" />
            <StatusTile label="Models" value="Governed" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileBrandHeader() {
  return (
    <div className="mb-6 flex items-center gap-2 lg:hidden">
      <img src="/open-one-mark.svg" alt="Open One" className="h-7 w-7" />
      <span className="text-[1.15rem] font-semibold tracking-tight text-[var(--dls-text-primary)]">
        Open One
      </span>
    </div>
  );
}

function SessionStatusPanel({ mode }: { mode: "checking" | "redirecting" }) {
  const status = mode === "checking"
    ? {
        title: "Checking account",
        body: "If you are already signed in, we will open your workspace. Otherwise you can continue here.",
      }
    : {
        title: "Opening workspace",
        body: "You are signed in. We are taking you to the right Cloud destination.",
      };

  return (
    <div className="grid gap-6" role="status" aria-live="polite">
      <div className="grid gap-3">
        <p className="den-eyebrow">Account</p>
        <div className="rounded-[1.5rem] border border-[var(--dls-border)] bg-[var(--dls-hover)]/60 p-4">
          <div className="flex items-start gap-3">
            <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--dls-accent)] opacity-30" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--dls-accent)]" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[14px] font-medium text-[var(--dls-text-primary)]">{status.title}</p>
              <p className="mt-1 text-[13px] leading-6 text-[var(--dls-text-secondary)]">{status.body}</p>
            </div>
          </div>
        </div>
      </div>
      <p className="m-0 text-xs leading-5 text-[var(--dls-text-secondary)]">
        No action needed.
      </p>
    </div>
  );
}

export function AuthScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const routingRef = useRef(false);
  const { user, sessionHydrated, desktopAuthRequested, resolveUserLandingRoute } = useDenFlow();
  const hasResolvedSession = sessionHydrated && Boolean(user) && !desktopAuthRequested;

  useEffect(() => {
    if (!hasResolvedSession || routingRef.current) {
      return;
    }

    const oauthRoute = typeof window === "undefined" ? null : getMcpOAuthSelectOrganizationRoute(window.location.search);
    if (oauthRoute && !isSamePathname(pathname, oauthRoute)) {
      router.replace(oauthRoute);
      return;
    }

    routingRef.current = true;
    void resolveUserLandingRoute()
      .then((target) => {
        if (target && !isSamePathname(pathname, target)) {
          router.replace(target);
        }
      })
      .finally(() => {
        routingRef.current = false;
      });
  }, [hasResolvedSession, pathname, resolveUserLandingRoute, router]);

  return (
    <section className="den-page flex w-full items-start py-3 sm:py-4 lg:min-h-[calc(100vh-2.5rem)] lg:items-center">
      <div className="den-frame relative w-full overflow-hidden">
        <div className="grid lg:grid-cols-[2fr_1fr]">
          {/* Brand panel is hidden on mobile; the form keeps a compact header. */}
          <ControlRoomPanel />

          {/* Auth form */}
          <div className="flex flex-col justify-center border-[var(--dls-border)] px-5 py-6 sm:px-7 sm:py-8 md:px-9 md:py-10 lg:border-l">
            {/* Mobile-only brand header. */}
            <MobileBrandHeader />
            {!sessionHydrated ? (
              <SessionStatusPanel mode="checking" />
            ) : hasResolvedSession ? (
              <SessionStatusPanel mode="redirecting" />
            ) : (
              <AuthPanel bare emailFirstFlow />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Clipboard, Download, Laptop, PackageCheck, ShieldCheck, Sparkles } from "lucide-react";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import { buildInstallDownloadHref, type InstallPlatform } from "../_lib/install-download";
import { isMobileUserAgent } from "../_lib/platform";

type InstallConfig = {
  appName: string;
  clientName: string;
  webUrl: string;
  apiUrl: string;
  requireSignin: boolean;
  logoUrl: string | null;
};

const platformOptions: Array<{ value: InstallPlatform; label: string }> = [
  { value: "mac-arm64", label: "Mac (Apple silicon)" },
  { value: "mac-x64", label: "Mac (Intel)" },
  { value: "win-x64", label: "Windows" },
  { value: "linux-x64", label: "Linux (x64)" },
  { value: "linux-arm64", label: "Linux (ARM64)" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function parseInstallConfig(value: unknown): InstallConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const clientName = typeof value.clientName === "string" ? value.clientName.trim() : "";
  const appName = typeof value.appName === "string" && value.appName.trim() ? value.appName.trim() : "OpenWork";
  const webUrl = typeof value.webUrl === "string" ? value.webUrl.trim() : "";
  const apiUrl = typeof value.apiUrl === "string" ? value.apiUrl.trim() : "";
  const requireSignin = value.requireSignin;
  const logoUrl = value.logoUrl;

  if (!clientName || !isUrl(webUrl) || !isUrl(apiUrl) || typeof requireSignin !== "boolean") {
    return null;
  }
  if (logoUrl !== null && (typeof logoUrl !== "string" || !isUrl(logoUrl))) {
    return null;
  }

  return {
    appName,
    clientName,
    webUrl,
    apiUrl,
    requireSignin,
    logoUrl,
  };
}

function detectPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") {
    return "mac-arm64";
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.includes("win") || userAgent.includes("windows")) {
    return "win-x64";
  }
  if (platform.includes("linux") || userAgent.includes("linux")) {
    return userAgent.includes("aarch64") || userAgent.includes("arm64") ? "linux-arm64" : "linux-x64";
  }
  return "mac-arm64";
}

function installHref(config: InstallConfig, platform: InstallPlatform, token: string) {
  return buildInstallDownloadHref(config.apiUrl, platform, token);
}

function platformShortLabel(platform: InstallPlatform): string {
  return platform === "win-x64" ? "Windows" : platform.startsWith("mac") ? "macOS" : "Linux";
}

export function InstallScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [config, setConfig] = useState<InstallConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform>("mac-arm64");
  const [copied, setCopied] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "started">("idle");
  const [downloadLabel, setDownloadLabel] = useState("");
  const [downloadHref, setDownloadHref] = useState("");
  const downloadStartedTimer = useRef<number | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      if (!token) {
        setError("This install link is missing its token. Ask your workspace admin for a fresh link.");
        setBusy(false);
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const { response, payload } = await requestJson(`/v1/install-config?token=${encodeURIComponent(token)}`, { method: "GET" }, 12000);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(getErrorMessage(payload, response.status === 404 ? "This install link is expired or no longer available." : `Could not load this install link (${response.status}).`));
          setConfig(null);
          return;
        }
        const parsed = parseInstallConfig(payload);
        if (!parsed) {
          setError("This install link returned incomplete setup details.");
          setConfig(null);
          return;
        }
        setConfig(parsed);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load this install link.");
          setConfig(null);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => () => {
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
  }, []);

  const secondaryPlatforms = useMemo(() => platformOptions.filter((option) => option.value !== platform), [platform]);

  async function copyCurrentLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function beginDownload(label: string, href: string) {
    setDownloadLabel(label);
    setDownloadHref(href);
    setDownloadState("preparing");
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
    downloadStartedTimer.current = window.setTimeout(() => {
      setDownloadState("started");
      downloadStartedTimer.current = null;
    }, 5000);
  }

  if (busy) {
    return (
      <section className="open-one-install-page grid min-h-dvh place-items-center" data-testid="install-page">
        <div className="open-one-install-loading">
          <span className="open-one-install-loading-mark" aria-hidden="true" />
          <p className="open-one-install-kicker">OPEN ONE DESKTOP</p>
          <h1>正在准备你的安装包</h1>
          <p>正在读取工作区和设备配置。</p>
        </div>
      </section>
    );
  }

  if (!config) {
    return (
      <section className="open-one-install-page grid min-h-dvh place-items-center" data-testid="install-page">
        <div className="open-one-install-loading">
          <p className="open-one-install-kicker">OPEN ONE DESKTOP</p>
          <h1>安装链接不可用</h1>
          <p>{error ?? "请向工作区管理员获取新的安装链接。"}</p>
        </div>
      </section>
    );
  }

  const primaryHref = installHref(config, platform, token);
  const primaryLabel = platformOptions.find((option) => option.value === platform)?.label ?? "your computer";
  const productName = config.appName || "Open One";

  return (
    <section className="open-one-install-page" data-testid="install-page">
      <header className="open-one-install-nav">
        <div className="open-one-install-brand">
          {config.logoUrl ? (
            // Organization logos may be served by private on-prem hosts that
            // are intentionally absent from this deployment's image allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt={`${config.clientName} logo`} className="open-one-install-org-logo" />
          ) : (
            <Image src="/open-one-mark.svg" alt="Open One" width={38} height={38} priority />
          )}
          <span>{productName}</span>
        </div>
        <span className="open-one-install-workspace">{config.clientName}</span>
      </header>

      <main className="open-one-install-hero" data-testid="install-card">
        <div className="open-one-install-copy">
          <div className="open-one-install-overline"><Sparkles size={14} /> WORKSPACE DESKTOP</div>
          <h1>为 {config.clientName} 准备好的<br />{productName}。</h1>
          <p>一次安装，即可进入你的团队工作区、模型连接和共享能力。安装包已包含当前组织的登录与工作区配置。</p>

          {isMobile ? (
            <div className="open-one-install-mobile-note" data-testid="install-mobile-note">
              <Laptop size={20} aria-hidden="true" />
              <div>
                <strong>请在电脑上完成安装</strong>
                <span>将此链接发送到 Windows、macOS 或 Linux 设备。</span>
              </div>
              <button type="button" className="open-one-install-secondary" onClick={() => void copyCurrentLink()}>
                <Clipboard size={16} /> {copied ? "已复制" : "复制安装链接"}
              </button>
            </div>
          ) : (
            <>
              <div className="open-one-install-actions">
                <a className="open-one-install-primary" href={primaryHref} data-testid="install-download-primary" onClick={() => beginDownload(primaryLabel, primaryHref)}>
                  <Download size={18} /> 下载 {primaryLabel} <ArrowRight size={17} />
                </a>
                <button type="button" className="open-one-install-secondary" onClick={() => void copyCurrentLink()}>
                  <Clipboard size={16} /> {copied ? "链接已复制" : "复制链接"}
                </button>
              </div>
              <p className="open-one-install-platform-note">已检测到 {platformShortLabel(platform)}。需要其他设备？</p>
              <div className="open-one-install-platforms">
                {secondaryPlatforms.map((option) => (
                  <a key={option.value} href={installHref(config, option.value, token)} onClick={() => beginDownload(option.label, installHref(config, option.value, token))}>
                    {option.label}
                  </a>
                ))}
              </div>
            </>
          )}

          {downloadState !== "idle" ? (
            <div className="open-one-install-status" aria-live="polite" data-testid="install-download-status">
              {downloadState === "preparing" ? (
                <><span className="open-one-install-spinner" aria-hidden="true" /><strong>正在准备 {downloadLabel} 安装包</strong><span>首次下载可能需要一分钟，请保持此页面打开。</span></>
              ) : (
                <><Check size={18} aria-hidden="true" /><strong>下载已开始</strong><span>若浏览器没有出现下载，请再次尝试。</span><a href={downloadHref} onClick={() => beginDownload(downloadLabel, downloadHref)}>重新下载</a></>
              )}
            </div>
          ) : null}
        </div>

        <div className="open-one-install-preview" aria-label={`${productName} desktop application preview`}>
          <div className="open-one-install-preview-bar">
            <span className="open-one-install-preview-led" />
            <span>OPEN ONE DESKTOP</span>
            <span>READY FOR {config.clientName.toUpperCase()}</span>
          </div>
          <Image
            src="/open-one-desktop-preview.png"
            alt="Open One desktop workspace"
            width={1428}
            height={1016}
            priority
            className="open-one-install-preview-image"
          />
        </div>
      </main>

      <section className="open-one-install-details" aria-label="Installation details">
        <div>
          <PackageCheck size={20} aria-hidden="true" />
          <h2>已为组织预配置</h2>
          <p>下载后直接进入 {config.clientName} 的 Open One 工作区，无需手动寻找服务器地址。</p>
        </div>
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <h2>账户与设备分离</h2>
          <p>{config.requireSignin ? "首次打开需要使用组织账户登录。" : "当前工作区允许按组织策略继续配置。"}</p>
        </div>
        <div>
          <Laptop size={20} aria-hidden="true" />
          <h2>适用于桌面设备</h2>
          <p>支持 Windows、macOS 和 Linux。每个安装包均保留标准更新和卸载能力。</p>
        </div>
      </section>
    </section>
  );
}

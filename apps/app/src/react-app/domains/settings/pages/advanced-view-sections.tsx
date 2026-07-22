/** @jsxImportSource react */
import { useState, type ComponentProps, type ReactNode } from "react";
import { CircleAlert, Cpu, Database, Info, RefreshCcw, Server } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { OpenworkRuntimeConfigStatus, OpenworkServerStatus } from "@/app/lib/openwork-server";
import {
  DEFAULT_DEN_API_BASE_URL,
  DEFAULT_DEN_BASE_URL,
  readDenBootstrapConfig,
  readDenSettings,
} from "@/app/lib/den";
import {
  describeCloudMcpTarget,
  describeDenEndpointSource,
  type DenEndpointSource,
} from "@/app/lib/den-endpoint-sources";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { ControlPlaneUrlEditor } from "../cloud/control-plane-url-editor";
import {
  displayCustomControlPlaneUrl,
  isValidControlPlaneUrl,
} from "../cloud/control-plane-url";
import {
  SettingsInset,
  SettingsNotice,
  SettingsStatusBadge,
} from "../settings-section";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemFootnote,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

type SettingsTone = ComponentProps<typeof SettingsStatusBadge>["tone"];

const DESKTOP_BOOTSTRAP_PATH_HINT = "~/.config/openwork/desktop-bootstrap.json";

function sourceBadgeLabel(source: DenEndpointSource): string {
  switch (source) {
    case "custom":
      return t("settings.server_endpoints_source_custom");
    case "bootstrap":
      return t("settings.server_endpoints_source_bootstrap");
    case "default":
      return t("settings.server_endpoints_source_default");
  }
}

function sourceBadgeClass(source: DenEndpointSource): string {
  switch (source) {
    case "custom":
      return "border-blue-7/40 bg-blue-3 text-blue-11";
    case "bootstrap":
      return "border-amber-7/40 bg-amber-3 text-amber-11";
    case "default":
      return "border-gray-7/50 bg-gray-3 text-gray-11";
  }
}

function EndpointSourceBadge(props: { source: DenEndpointSource }) {
  return (
    <Badge variant="outline" className={sourceBadgeClass(props.source)}>
      {sourceBadgeLabel(props.source)}
    </Badge>
  );
}

function EndpointWarningBadge(props: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="border-amber-7/40 bg-amber-3 text-amber-11">
      {props.children}
    </Badge>
  );
}

function EndpointRow(props: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-xl border border-gray-6/50 bg-gray-1/60 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-9">
        {props.label}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="truncate font-mono text-xs text-gray-12" title={props.value}>
          {props.value}
        </div>
        {props.children ? <div className="flex flex-wrap gap-1.5">{props.children}</div> : null}
      </div>
    </div>
  );
}

function bootstrapValueWhenNotDefault(value: string, buildDefault: string): string | null {
  const fallback = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: null,
    buildDefault,
  });
  return value === fallback.effective ? null : value;
}

function ServerEndpointsCard(props: { cloudMcpUrl: string | null }) {
  const settings = readDenSettings();
  const effectiveApiBaseUrl = settings.apiBaseUrl ?? DEFAULT_DEN_API_BASE_URL;
  const bootstrap = readDenBootstrapConfig();
  const organizationServer = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: bootstrapValueWhenNotDefault(bootstrap.baseUrl, DEFAULT_DEN_BASE_URL),
    buildDefault: DEFAULT_DEN_BASE_URL,
  });
  const apiEndpoint = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: bootstrapValueWhenNotDefault(bootstrap.apiBaseUrl, DEFAULT_DEN_API_BASE_URL),
    buildDefault: DEFAULT_DEN_API_BASE_URL,
  });
  const cloudMcp = describeCloudMcpTarget({
    mcpUrl: props.cloudMcpUrl,
    effectiveApiBaseUrl,
  });
  const hasBootstrapSource = organizationServer.source === "bootstrap" || apiEndpoint.source === "bootstrap";

  return (
    <SettingsInset className="space-y-3 bg-gray-1/40">
      <div className="space-y-1">
        <div className="text-sm font-medium text-gray-12">{t("settings.server_endpoints_title")}</div>
        <div className="text-xs text-gray-9">{t("settings.server_endpoints_desc")}</div>
      </div>

      <div className="space-y-2">
        <EndpointRow label={t("settings.server_endpoints_org")} value={settings.baseUrl}>
          <EndpointSourceBadge source={organizationServer.source} />
        </EndpointRow>
        <EndpointRow label={t("settings.server_endpoints_api")} value={effectiveApiBaseUrl}>
          <EndpointSourceBadge source={apiEndpoint.source} />
        </EndpointRow>
        <EndpointRow
          label={t("settings.server_endpoints_cloud_mcp")}
          value={cloudMcp.url ?? t("settings.server_endpoints_not_configured")}
        >
          {cloudMcp.url && cloudMcp.isLocalhost ? (
            <EndpointWarningBadge>{t("settings.server_endpoints_local_dev")}</EndpointWarningBadge>
          ) : null}
          {cloudMcp.url && !cloudMcp.matchesApi ? (
            <EndpointWarningBadge>{t("settings.server_endpoints_mismatch")}</EndpointWarningBadge>
          ) : null}
        </EndpointRow>
      </div>

      {hasBootstrapSource ? (
        <div className="text-[11px] text-amber-11">
          {t("settings.server_endpoints_bootstrap_hint", { path: DESKTOP_BOOTSTRAP_PATH_HINT })}
        </div>
      ) : null}
    </SettingsInset>
  );
}

interface AdvancedOrganizationServerSectionProps {
  authBusy: boolean;
  baseUrl: string;
  baseUrlBusy: boolean;
  baseUrlDraft: string;
  baseUrlError: string | null;
  onApplyBaseUrl: () => void | Promise<void>;
  onBaseUrlDraftChange: (value: string) => void;
  onClearServerConfiguration: () => void | Promise<void>;
  onResetBaseUrlToDefault: () => void | Promise<void>;
  sessionBusy: boolean;
  cloudMcpUrl: string | null;
}

export function AdvancedOrganizationServerSection(props: AdvancedOrganizationServerSectionProps) {
  const [clearConfirming, setClearConfirming] = useState(false);
  const controlsDisabled = [props.authBusy, props.baseUrlBusy, props.sessionBusy].some(Boolean);
  const customUrl = displayCustomControlPlaneUrl(props.baseUrlDraft);
  const currentUrl = displayCustomControlPlaneUrl(props.baseUrl);
  const clearServerConfiguration = () => {
    if (!clearConfirming) {
      setClearConfirming(true);
      return;
    }
    setClearConfirming(false);
    void props.onClearServerConfiguration();
  };

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.organization_server_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.organization_server_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <ControlPlaneUrlEditor
          disabled={controlsDisabled}
          hint={t("settings.organization_server_url_hint")}
          label={t("settings.organization_server_url_label")}
          onReset={props.onResetBaseUrlToDefault}
          onSave={props.onApplyBaseUrl}
          onValueChange={props.onBaseUrlDraftChange}
          placeholder={DEFAULT_DEN_BASE_URL}
          resetLabel={t("common.reset")}
          saveDisabled={!isValidControlPlaneUrl(customUrl)}
          saveLabel={t("common.save")}
          value={customUrl}
        />
        <LayoutSectionItemFootnote>
          {currentUrl
            ? t("settings.organization_server_current", { url: currentUrl })
            : t("settings.organization_server_default")}
        </LayoutSectionItemFootnote>
        {isDesktopRuntime() ? <ServerEndpointsCard cloudMcpUrl={props.cloudMcpUrl} /> : null}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-9">
          <Button
            variant={clearConfirming ? "destructive" : "outline"}
            size="sm"
            onClick={clearServerConfiguration}
            disabled={controlsDisabled}
          >
            {clearConfirming
              ? t("den.cloud_control_plane_clear_confirm")
              : t("den.cloud_control_plane_clear")}
          </Button>
          <span>
            {clearConfirming
              ? t("den.cloud_control_plane_clear_confirm_hint")
              : t("den.cloud_control_plane_clear_hint")}
          </span>
        </div>
        {props.baseUrlError ? <SettingsNotice tone="error">{props.baseUrlError}</SettingsNotice> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface RuntimeStatusCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  statusLabel: string;
  tone: SettingsTone;
  detailLines?: string[];
}

function RuntimeStatusCard(props: RuntimeStatusCardProps) {
  return (
    <SettingsInset className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gray-6/60 bg-gray-1/70 text-gray-12">
          {props.icon}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-12">{props.title}</div>
          <div className="text-xs text-gray-9">{props.description}</div>
        </div>
      </div>
      <SettingsStatusBadge className="inline-flex min-h-0 justify-start px-0 py-0" tone={props.tone} label={props.statusLabel} />
      {props.detailLines?.length ? (
        <div className="space-y-1 border-t border-gray-6/50 pt-2 text-[11px] text-gray-9">
          {props.detailLines.map((line) => (
            <div key={line} className="truncate" title={line}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </SettingsInset>
  );
}

interface AdvancedRuntimeSectionProps {
  clientStatusLabel: string;
  clientTone: SettingsTone;
  clientDetailLines: string[];
  openworkStatusLabel: string;
  openworkTone: SettingsTone;
  openworkDetailLines: string[];
}

export function AdvancedRuntimeSection(props: AdvancedRuntimeSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.runtime_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.runtime_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <RuntimeStatusCard
          icon={<Cpu size={18} />}
          title={t("settings.opencode_engine_label")}
          description={t("settings.opencode_engine_desc")}
          statusLabel={props.clientStatusLabel}
          tone={props.clientTone}
          detailLines={props.clientDetailLines}
        />
        <RuntimeStatusCard
          icon={<Server size={18} />}
          title={t("settings.openwork_server_label")}
          description={t("settings.openwork_server_desc")}
          statusLabel={props.openworkStatusLabel}
          tone={props.openworkTone}
          detailLines={props.openworkDetailLines}
        />
      </div>
    </LayoutSection>
  );
}

interface AdvancedRuntimeMigrationSectionProps {
  busy: boolean;
  canMigrate: boolean;
  migrationBusy: boolean;
  migrationStatus: string | null;
  configStatus: OpenworkRuntimeConfigStatus | null;
  configStatusBusy: boolean;
  configStatusError: string | null;
  onRefresh: () => Promise<void>;
  onMigrate: () => Promise<void>;
}

function formatKeys(keys: string[]) {
  return keys.length ? keys.join(", ") : t("settings.runtime_config_none");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countRecord(value: unknown) {
  return isRecord(value) ? Object.keys(value).length : 0;
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function providerModelCount(config: Record<string, unknown>) {
  const providers = isRecord(config.provider) ? config.provider : {};
  return Object.values(providers).reduce<number>((total, provider) => {
    if (!isRecord(provider)) return total;
    return total + countRecord(provider.models);
  }, 0);
}

function runtimeConfigStats(config: Record<string, unknown>) {
  const providers = countRecord(config.provider);
  const models = providerModelCount(config);
  const agents = countRecord(config.agent);
  const plugins = countArray(config.plugin);
  const mcps = countRecord(config.mcp);
  const permissions = countRecord(config.permission);
  const disabledProviders = countArray(config.disabled_providers);
  const defaultAgent = typeof config.default_agent === "string"
    ? config.default_agent
    : t("settings.runtime_config_not_set");

  return { agents, defaultAgent, disabledProviders, mcps, models, permissions, plugins, providers };
}

function RuntimeConfigSummary(props: { config: Record<string, unknown> }) {
  const stats = runtimeConfigStats(props.config);

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="min-h-16 rounded-lg border border-gray-6 bg-gray-2/70 p-3">
        <div className="text-[11px] font-medium text-gray-9">
          {t("settings.runtime_config_default_agent")}
        </div>
        <div className="mt-1 truncate font-mono text-sm text-gray-12" title={stats.defaultAgent}>
          {stats.defaultAgent}
        </div>
      </div>
      <div className="min-h-16 rounded-lg border border-gray-6 bg-gray-2/70 p-3">
        <div className="text-[11px] font-medium text-gray-9">
          {t("settings.runtime_config_providers_models")}
        </div>
        <div className="mt-1 font-mono text-sm text-gray-12">
          {t("settings.runtime_config_providers_models_value", { providers: stats.providers, models: stats.models })}
        </div>
      </div>
      <div className="min-h-16 rounded-lg border border-gray-6 bg-gray-2/70 p-3">
        <div className="text-[11px] font-medium text-gray-9">
          {t("settings.runtime_config_agents_plugins")}
        </div>
        <div className="mt-1 font-mono text-sm text-gray-12">
          {t("settings.runtime_config_agents_plugins_value", { agents: stats.agents, plugins: stats.plugins })}
        </div>
      </div>
      <div className="min-h-16 rounded-lg border border-gray-6 bg-gray-2/70 p-3">
        <div className="text-[11px] font-medium text-gray-9">
          {t("settings.runtime_config_mcp_permissions")}
        </div>
        <div className="mt-1 font-mono text-sm text-gray-12">
          {t("settings.runtime_config_mcp_permissions_value", { mcps: stats.mcps, permissions: stats.permissions })}
        </div>
      </div>
      {stats.disabledProviders ? (
        <div className="rounded-lg border border-gray-6 bg-gray-2/70 p-3 sm:col-span-2 lg:col-span-4">
          <div className="text-[11px] font-medium text-gray-9">
            {t("settings.runtime_config_disabled_providers")}
          </div>
          <div className="mt-1 font-mono text-[11px] text-gray-12">{stats.disabledProviders}</div>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeConfigCompactSummary(props: { config: Record<string, unknown> }) {
  const stats = runtimeConfigStats(props.config);

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-md bg-gray-2 px-2.5 py-2">
        <div className="text-[10px] font-medium uppercase text-gray-8">
          {t("settings.runtime_config_agent")}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-gray-12" title={stats.defaultAgent}>
          {stats.defaultAgent}
        </div>
      </div>
      <div className="rounded-md bg-gray-2 px-2.5 py-2">
        <div className="text-[10px] font-medium uppercase text-gray-8">
          {t("settings.runtime_config_providers_models")}
        </div>
        <div className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-gray-12">
          {t("settings.runtime_config_providers_models_value", { providers: stats.providers, models: stats.models })}
        </div>
      </div>
      <div className="rounded-md bg-gray-2 px-2.5 py-2">
        <div className="text-[10px] font-medium uppercase text-gray-8">
          {t("settings.runtime_config_agents_plugins")}
        </div>
        <div className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-gray-12">
          {t("settings.runtime_config_agents_plugins_value", { agents: stats.agents, plugins: stats.plugins })}
        </div>
      </div>
      <div className="rounded-md bg-gray-2 px-2.5 py-2">
        <div className="text-[10px] font-medium uppercase text-gray-8">
          {t("settings.runtime_config_mcp_permissions")}
        </div>
        <div className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-gray-12">
          {t("settings.runtime_config_mcp_permissions_value", { mcps: stats.mcps, permissions: stats.permissions })}
        </div>
      </div>
      {stats.disabledProviders ? (
        <div className="rounded-md bg-gray-2 px-2.5 py-2 md:col-span-2 xl:col-span-4">
          <div className="text-[10px] font-medium uppercase text-gray-8">
            {t("settings.runtime_config_disabled_providers")}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-gray-12">{stats.disabledProviders}</div>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeConfigSourceBlock(props: {
  title: string;
  description: string;
  path?: string;
  exists?: boolean;
  keys: string[];
  config: Record<string, unknown>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-6 bg-gray-1">
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-gray-12">{props.title}</div>
            <div className="text-[11px] text-gray-9">{props.description}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {props.exists !== undefined ? (
              <Badge
                variant="outline"
                className={props.exists ? "border-green-7/40 bg-green-3 text-green-11" : "border-gray-7/50 bg-gray-3 text-gray-10"}
              >
                {props.exists
                  ? t("settings.runtime_config_found")
                  : t("settings.runtime_config_not_found")}
              </Badge>
            ) : null}
            <Badge variant="outline" className="border-gray-7/50 bg-gray-3 text-gray-11">
              {t("settings.runtime_config_key_count", { count: props.keys.length })}
            </Badge>
          </div>
        </div>
        {props.path ? (
          <div className="break-all rounded-md bg-gray-2 px-2 py-1.5 font-mono text-[11px] text-gray-8">
            {props.path}
          </div>
        ) : null}
        <div className="text-[11px] text-gray-9">
          {t("settings.runtime_config_keys", { keys: formatKeys(props.keys) })}
        </div>
        <RuntimeConfigCompactSummary config={props.config} />
      </div>
      <details className="border-t border-gray-6 bg-gray-2/70 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-gray-11">
          {t("settings.runtime_config_show_raw_json")}
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto font-mono text-[11px] text-gray-11">
          {JSON.stringify(props.config, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function AdvancedRuntimeMigrationSection(props: AdvancedRuntimeMigrationSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.runtime_config_sources_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>
          {t("settings.runtime_config_sources_desc")}
        </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.runtime_config_move_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>
            {t("settings.runtime_config_move_desc")}
          </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onRefresh()}
              disabled={props.busy || props.configStatusBusy || !props.canMigrate}
            >
              <RefreshCcw size={14} className={props.configStatusBusy ? "animate-spin" : ""} />
              {t("settings.runtime_config_refresh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onMigrate()}
              disabled={props.busy || props.migrationBusy || !props.canMigrate}
            >
              <Database size={14} />
              {props.migrationBusy
                ? t("settings.runtime_config_migrating")
                : t("settings.runtime_config_migrate")}
            </Button>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        {props.migrationStatus ? <SettingsNotice>{props.migrationStatus}</SettingsNotice> : null}
        {props.configStatusError ? <SettingsNotice>{props.configStatusError}</SettingsNotice> : null}
        {props.configStatus ? (
          <div className="space-y-4 text-xs text-gray-10">
            <div className="space-y-3 rounded-lg border border-blue-6/50 bg-blue-2/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-12">
                    {t("settings.runtime_config_effective_title")}
                  </div>
                  <div className="mt-1 max-w-3xl text-[11px] text-gray-9">
                    {t("settings.runtime_config_effective_desc")}
                  </div>
                </div>
                <Badge variant="outline" className="border-blue-7/40 bg-blue-3 text-blue-11">
                  {t("settings.runtime_config_runtime_source")}
                </Badge>
              </div>
              <RuntimeConfigSummary config={props.configStatus.effectiveRuntime ?? props.configStatus.runtime} />
              <details className="rounded-md bg-gray-3 p-2">
                <summary className="cursor-pointer text-[11px] font-medium text-gray-11">
                  {t("settings.runtime_config_show_raw_injected_json")}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto font-mono text-[11px] text-gray-11">
                  {JSON.stringify(props.configStatus.effectiveRuntime ?? props.configStatus.runtime, null, 2)}
                </pre>
              </details>
            </div>
            {props.configStatus.sources ? (
              <div className="space-y-3">
                <div>
                  <div className="font-medium text-gray-12">
                    {t("settings.runtime_config_source_breakdown_title")}
                  </div>
                  <div className="max-w-4xl text-[11px] text-gray-9">
                    {t("settings.runtime_config_source_breakdown_desc")}
                  </div>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <RuntimeConfigSourceBlock
                    title={t("settings.runtime_config_project_title")}
                    description={t("settings.runtime_config_project_desc")}
                    path={props.configStatus.sources.projectOpencode.path}
                    exists={props.configStatus.sources.projectOpencode.exists}
                    keys={props.configStatus.sources.projectOpencode.keys}
                    config={props.configStatus.sources.projectOpencode.config}
                  />
                  <RuntimeConfigSourceBlock
                    title={t("settings.runtime_config_global_title")}
                    description={t("settings.runtime_config_global_desc")}
                    path={props.configStatus.sources.globalOpencode.path}
                    exists={props.configStatus.sources.globalOpencode.exists}
                    keys={props.configStatus.sources.globalOpencode.keys}
                    config={props.configStatus.sources.globalOpencode.config}
                  />
                  <RuntimeConfigSourceBlock
                    title={t("settings.runtime_config_runtime_db_title")}
                    description={t("settings.runtime_config_runtime_db_desc")}
                    keys={props.configStatus.sources.runtimeDatabase.keys}
                    config={props.configStatus.sources.runtimeDatabase.config}
                  />
                  <RuntimeConfigSourceBlock
                    title={t("settings.runtime_config_injected_title")}
                    description={t("settings.runtime_config_injected_desc")}
                    keys={props.configStatus.sources.injected.keys}
                    config={props.configStatus.sources.injected.config}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-gray-6 bg-gray-1 p-3">
                <div className="font-medium text-gray-12">
                  {t("settings.runtime_config_runtime_database")}
                </div>
                <div className="mt-1 text-[11px] text-gray-9">
                  {t("settings.runtime_config_stored_keys", { keys: formatKeys(props.configStatus.runtimeKeys) })}
                </div>
              </div>
              <div className="rounded-lg border border-gray-6 bg-gray-1 p-3">
                <div className="font-medium text-gray-12">
                  {t("settings.runtime_config_legacy_metadata")}
                </div>
                <div className="mt-1 break-all font-mono text-[11px] text-gray-8">{props.configStatus.legacyOpenwork.path}</div>
                {props.configStatus.legacyOpenwork.error ? (
                  <div className="mt-1 text-[11px] text-amber-11">
                    {t("settings.runtime_config_legacy_error_hint", { error: props.configStatus.legacyOpenwork.error })}
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] text-gray-9">
                  {t("settings.runtime_config_migratable_keys", { keys: formatKeys(props.configStatus.legacyOpenwork.keys) })}
                </div>
              </div>
              <div className="rounded-lg border border-gray-6 bg-gray-1 p-3">
                <div className="font-medium text-gray-12">
                  {t("settings.runtime_config_user_opencode")}
                </div>
                <div className="mt-1 break-all font-mono text-[11px] text-gray-8">{props.configStatus.userOpencode.path}</div>
                <div className="mt-1 text-[11px] text-gray-9">
                  {props.configStatus.userOpencode.exists
                    ? t("settings.runtime_config_found")
                    : t("settings.runtime_config_not_found")}
                </div>
                <div className="text-[11px] text-gray-9">
                  {t("settings.runtime_config_user_owned_keys", { keys: formatKeys(props.configStatus.userOpencode.keys) })}
                </div>
                <div className="text-[11px] text-gray-9">
                  {t("settings.runtime_config_migratable_keys", { keys: formatKeys(props.configStatus.userOpencode.migratableKeys) })}
                </div>
              </div>
            </div>
            <details className="rounded-lg border border-gray-6 bg-gray-1 p-3">
              <summary className="cursor-pointer font-medium text-gray-12">
                {t("settings.runtime_config_runtime_db_json")}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-gray-3 p-2 font-mono text-[11px] text-gray-11">
                {JSON.stringify(props.configStatus.runtime, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedOpencodeSectionProps {
  busy: boolean;
  enabled: boolean;
  onToggle: () => void;
}

export function AdvancedOpencodeSection(props: AdvancedOpencodeSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>
          {t("settings.opencode_section_label")}
        </LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.opencode_engine_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.enable_exa")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.enable_exa_desc")}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label={t("settings.enable_exa")}
              checked={props.enabled}
              disabled
              onCheckedChange={props.onToggle}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <Alert>
          <Info />
          <AlertDescription>{t("settings.exa_unavailable")}</AlertDescription>
        </Alert>
        <LayoutSectionItemFootnote>{t("settings.exa_restart_hint")}</LayoutSectionItemFootnote>
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedFeatureFlagsSectionProps {
  busy: boolean;
  microsandboxCreateSandboxEnabled: boolean;
  onToggleMicrosandboxCreateSandbox: () => void;
}

export function AdvancedFeatureFlagsSection(props: AdvancedFeatureFlagsSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.feature_flags_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.feature_flags_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.feature_flags_microsandbox_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>
            {t("settings.feature_flags_microsandbox_desc")}
          </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label={t("settings.feature_flags_microsandbox_title")}
              checked={props.microsandboxCreateSandboxEnabled}
              disabled={props.busy || !isDesktopRuntime()}
              onCheckedChange={props.onToggleMicrosandboxCreateSandbox}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedDeveloperSectionProps {
  busy: boolean;
  developerMode: boolean;
  opencodeDevModeEnabled: boolean;
  deepLinkOpen: boolean;
  deepLinkInput: string;
  deepLinkBusy: boolean;
  deepLinkStatus: string | null;
  onToggleDeveloperMode: () => void;
  onToggleDeepLink: () => void;
  onDeepLinkInput: (input: string) => void;
  onSubmitDeepLink: () => Promise<void>;
}

export function AdvancedDeveloperSection(props: AdvancedDeveloperSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.developer")}</LayoutSectionTitle>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.developer_mode_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.developer_mode_desc")}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label={t("settings.developer_mode_title")}
              checked={props.developerMode}
              onCheckedChange={props.onToggleDeveloperMode}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>

      {isDesktopRuntime() && props.opencodeDevModeEnabled && props.developerMode ? (
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.open_deeplink_title")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.open_deeplink_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onToggleDeepLink}
                disabled={props.busy || props.deepLinkBusy}
              >
                {props.deepLinkOpen ? t("common.hide") : t("settings.open_deeplink_button")}
              </Button>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>

          {props.deepLinkOpen ? (
            <div className="space-y-3">
              <Field>
                <FieldLabel htmlFor="advanced-debug-deep-link">{t("settings.open_deeplink_title")}</FieldLabel>
                <Textarea
                  id="advanced-debug-deep-link"
                  value={props.deepLinkInput}
                  onChange={(event) => props.onDeepLinkInput(event.currentTarget.value)}
                  rows={3}
                  placeholder="openone://..."
                  className="font-mono text-xs"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void props.onSubmitDeepLink()}
                  disabled={props.busy || props.deepLinkBusy || !props.deepLinkInput.trim()}
                >
                  {props.deepLinkBusy ? t("settings.opening") : t("settings.open_deeplink_action")}
                </Button>
                <div className="text-xs text-gray-8">{t("settings.deeplink_hint")}</div>
              </div>
            </div>
          ) : null}

          {props.deepLinkStatus ? <SettingsNotice>{props.deepLinkStatus}</SettingsNotice> : null}
        </LayoutSectionItem>
      ) : null}
    </LayoutSection>
  );
}

interface AdvancedConnectionSectionProps {
  busy: boolean;
  headerStatus: string;
  baseUrl: string;
  openworkServerUrl: string;
  openworkServerStatus: OpenworkServerStatus;
  openworkReconnectBusy: boolean;
  isLocalEngineRunning: boolean;
  restartBusy: boolean;
  reconnectStatus: string | null;
  reconnectError: string | null;
  restartStatus: string | null;
  restartError: string | null;
  onReconnect: () => Promise<void>;
  onRestart: () => Promise<void>;
  onStopHost: () => void;
}

export function AdvancedConnectionSection(props: AdvancedConnectionSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.connection_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{props.headerStatus}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem className="gap-3">
        <div className="break-all font-mono text-xs text-gray-8">{props.baseUrl}</div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void props.onReconnect()}
            disabled={props.busy || props.openworkReconnectBusy || !props.openworkServerUrl.trim()}
          >
            <RefreshCcw size={14} className={props.openworkReconnectBusy ? "animate-spin" : ""} />
            {props.openworkReconnectBusy ? t("settings.reconnecting") : t("settings.reconnect_server")}
          </Button>

          {props.isLocalEngineRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onRestart()}
              disabled={props.busy || props.restartBusy}
            >
              <RefreshCcw size={14} className={props.restartBusy ? "animate-spin" : ""} />
              {props.restartBusy ? t("settings.restarting") : t("settings.restart_openwork_server")}
            </Button>
          ) : null}

          {props.isLocalEngineRunning ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={props.onStopHost}
              disabled={props.busy}
            >
              <CircleAlert size={14} />
              {t("settings.stop_local_server")}
            </Button>
          ) : null}

          {!props.isLocalEngineRunning && props.openworkServerStatus === "connected" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.onStopHost}
              disabled={props.busy}
            >
              {t("settings.disconnect_server")}
            </Button>
          ) : null}
        </div>

        {props.reconnectStatus ? <SettingsNotice>{props.reconnectStatus}</SettingsNotice> : null}
        {props.reconnectError ? <SettingsNotice tone="error">{props.reconnectError}</SettingsNotice> : null}
        {props.restartStatus ? <SettingsNotice>{props.restartStatus}</SettingsNotice> : null}
        {props.restartError ? <SettingsNotice tone="error">{props.restartError}</SettingsNotice> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

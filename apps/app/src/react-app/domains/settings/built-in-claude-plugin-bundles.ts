import type { CloudImportedPlugin } from "@/app/cloud/import-state";

export type BuiltInClaudePluginBundle = {
  id: string;
  name: string;
  description: string;
  homepageUrl: string;
  sourceUrl: string;
  plugins: Array<{
    id: string;
    name: string;
    description: string;
    url: string;
    components: string;
  }>;
};

export type BuiltInClaudePluginBundleStatus = {
  status: "available" | "installed" | "update_available";
  installedCount: number;
  installedPluginIds: string[];
};

export type BuiltInClaudePluginBundleSummary = {
  resourceLabels: string[];
  contributionLabels: string[];
};

export const SAP_DEV_PLUGIN_BUNDLE: BuiltInClaudePluginBundle = {
  id: "sap-dev-skills",
  name: "SAP Dev Skills",
  description: "Windows-only SAP GUI automation skills for ABAP development, S/4HANA migration, generated code, and SAP project operations.",
  homepageUrl: "https://sapdev.ai",
  sourceUrl: "https://github.com/sapdev-ai/sap-dev",
  plugins: [
    {
      id: "github:sapdev-ai/sap-dev#plugins/sap-dev-core",
      name: "sap-dev-core",
      description: "Foundation plugin with SAP login, ABAP Workbench, ATC, transports, diagnostics, and the abap-developer agent.",
      url: "https://github.com/sapdev-ai/sap-dev/tree/main/plugins/sap-dev-core",
      components: "61 skills + 1 agent + shared runtime files",
    },
    {
      id: "github:sapdev-ai/sap-dev#plugins/sap-gen-code",
      name: "sap-gen-code",
      description: "Spec-to-ABAP pipeline for extracting, checking, generating, and reviewing ABAP artifacts.",
      url: "https://github.com/sapdev-ai/sap-dev/tree/main/plugins/sap-gen-code",
      components: "12 skills",
    },
    {
      id: "github:sapdev-ai/sap-dev#plugins/sap-migrate",
      name: "sap-migrate",
      description: "S/4HANA custom-code migration campaign workflows and the cc-migration-engineer agent.",
      url: "https://github.com/sapdev-ai/sap-dev/tree/main/plugins/sap-migrate",
      components: "10 skills + 1 agent",
    },
    {
      id: "github:sapdev-ai/sap-dev#plugins/sap-project",
      name: "sap-project",
      description: "Functional, release, operations, testing, authorizations, and AMS workflows with the sap-consultant agent.",
      url: "https://github.com/sapdev-ai/sap-dev/tree/main/plugins/sap-project",
      components: "40 skills + 1 agent",
    },
  ],
};

export function builtInClaudePluginStatus(
  bundle: BuiltInClaudePluginBundle,
  importedPlugins: Record<string, CloudImportedPlugin>,
): BuiltInClaudePluginBundleStatus {
  const installedPluginIds = bundle.plugins.flatMap((plugin) => importedPlugins[plugin.id] ? [plugin.id] : []);
  const installedCount = installedPluginIds.length;
  if (installedCount === bundle.plugins.length) return { status: "installed", installedCount, installedPluginIds };
  if (installedCount > 0) return { status: "update_available", installedCount, installedPluginIds };
  return { status: "available", installedCount, installedPluginIds };
}

export function builtInClaudePluginActionLabel(status: BuiltInClaudePluginBundleStatus) {
  if (status.status === "installed") return "View details";
  if (status.installedCount > 0) return "Install missing";
  return "Install";
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function objectTypeLabel(type: string, count: number) {
  switch (type) {
    case "skill":
      return plural(count, "skill");
    case "agent":
      return plural(count, "agent");
    case "mcp":
      return plural(count, "MCP server");
    case "command":
      return plural(count, "command");
    case "context":
      return plural(count, "context file");
    case "hook":
      return plural(count, "hook");
    case "tool":
      return plural(count, "tool");
    case "plugin":
      return plural(count, "plugin");
    default:
      return plural(count, type.replace(/[-_]+/g, " "));
  }
}

export function builtInClaudePluginBundleSummary(
  bundle: BuiltInClaudePluginBundle,
  importedPlugins: Record<string, CloudImportedPlugin>,
): BuiltInClaudePluginBundleSummary {
  const installedPlugins = bundle.plugins.flatMap((plugin) => {
    const imported = importedPlugins[plugin.id];
    return imported ? [imported] : [];
  });
  const installedCount = installedPlugins.length;
  const pluginLabel = installedCount > 0 && installedCount < bundle.plugins.length
    ? `${installedCount}/${bundle.plugins.length} plugins installed`
    : plural(bundle.plugins.length, "plugin");

  const countsByType = new Map<string, number>();
  const countedObjects = new Set<string>();
  for (const plugin of installedPlugins) {
    for (const file of plugin.files) {
      const objectType = file.objectType.trim().toLowerCase();
      if (!objectType) continue;
      const objectKey = `${objectType}:${file.configObjectId}`;
      if (countedObjects.has(objectKey)) continue;
      countedObjects.add(objectKey);
      countsByType.set(objectType, (countsByType.get(objectType) ?? 0) + 1);
    }
  }

  const preferredOrder = ["skill", "agent", "mcp", "command", "context", "hook", "tool"];
  const preferredLabels = preferredOrder.flatMap((type) => {
    const count = countsByType.get(type) ?? 0;
    return count > 0 ? [objectTypeLabel(type, count)] : [];
  });
  const otherLabels = [...countsByType.entries()]
    .filter(([type]) => !preferredOrder.includes(type))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => objectTypeLabel(type, count));

  return {
    resourceLabels: [pluginLabel, ...preferredLabels, ...otherLabels],
    contributionLabels: bundle.plugins.map((plugin) => importedPlugins[plugin.id]?.name ?? plugin.name),
  };
}

import { dirname } from "node:path";
import { listSkills } from "../skills.js";
import { runtimeMcpMap, runtimePluginList, type RuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { AgentRunCapabilities, AgentRunSkill } from "./types.js";

export async function resolveAgentRunCapabilities(
  workspacePath: string,
  runtimeConfig: RuntimeOpencodeConfig,
): Promise<AgentRunCapabilities> {
  const skills = await resolveSkills(workspacePath);
  return {
    mcpServers: enabledMcpServers(runtimeMcpMap(runtimeConfig)),
    skillRoots: uniqueStrings(skills.map(skillRoot)),
    skills,
    pluginPaths: uniqueStrings(runtimePluginList(runtimeConfig)),
  };
}

async function resolveSkills(workspacePath: string): Promise<AgentRunSkill[]> {
  try {
    return await listSkills(workspacePath, true);
  } catch {
    return [];
  }
}

function enabledMcpServers(servers: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(servers)) {
    const trimmed = name.trim();
    if (!trimmed || config.enabled === false) continue;
    result[trimmed] = config;
  }
  return result;
}

function skillRoot(skill: AgentRunSkill): string {
  return dirname(dirname(skill.path));
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

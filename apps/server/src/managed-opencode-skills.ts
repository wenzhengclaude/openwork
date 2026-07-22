import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { exists } from "./utils.js";
import { validateSkillName } from "./validators.js";

const MANIFEST_RELATIVE_PATH = ".opencode/openone/managed-skills.json";

type ManagedSkillEntry = {
  sourcePath: string;
  targetPath: string;
  sourceHash: string;
  updatedAt: number;
};

type ManagedSkillManifest = {
  version: 1;
  skills: Record<string, ManagedSkillEntry>;
};

type PluginSkillSource = {
  name: string;
  namespace: string | null;
  sourceDir: string;
  sourceSkillPath: string;
  sourceRelativeSkillPath: string;
  pluginRootDir: string | null;
  pluginSharedDir: string | null;
  targetSharedDir: string | null;
  targetDir: string;
  targetSkillPath: string;
  targetRelativeSkillPath: string;
};

export type ManagedOpenCodeSkillSyncResult = {
  written: string[];
  removed: string[];
  conflicts: Array<{ name: string; sourcePath: string; targetPath: string }>;
};

export async function syncManagedOpenCodeSkills(workspaceRoot: string): Promise<ManagedOpenCodeSkillSyncResult> {
  const root = resolve(workspaceRoot);
  const skillsDir = join(root, ".opencode", "skills");
  const agentsDir = join(root, ".opencode", "agents");
  const commandsDir = join(root, ".opencode", "commands");
  const pluginsDir = join(root, ".opencode", "plugins");
  const manifestPath = join(root, MANIFEST_RELATIVE_PATH);
  const manifest = await readManifest(manifestPath);
  await migrateLegacyPluginSkills(root, skillsDir, pluginsDir, manifest);
  await migrateLegacyPluginFiles(agentsDir, pluginsDir, "agents");
  await migrateLegacyPluginFiles(commandsDir, pluginsDir, "commands");
  const sources = await listPluginSkillSources(root, skillsDir, pluginsDir);
  const nextSkills: Record<string, ManagedSkillEntry> = {};
  const written: string[] = [];
  const removed: string[] = [];
  const conflicts: Array<{ name: string; sourcePath: string; targetPath: string }> = [];

  for (const source of sources) {
    if (nextSkills[source.name]) {
      conflicts.push({
        name: source.name,
        sourcePath: source.sourceRelativeSkillPath,
        targetPath: source.targetRelativeSkillPath,
      });
      continue;
    }
    const previous = manifest.skills[source.name];
    const flatNativeSkillPath = join(skillsDir, source.name, "SKILL.md");
    const flatNativeTargetPath = toWorkspaceRelativePath(root, flatNativeSkillPath);
    const flatNativeManaged = previous?.targetPath === flatNativeTargetPath;
    if (source.targetSkillPath !== flatNativeSkillPath && await exists(flatNativeSkillPath) && !flatNativeManaged) {
      if (await isOpenOneManagedSkillCandidate(flatNativeSkillPath)) {
        await rm(dirname(flatNativeSkillPath), { recursive: true, force: true });
        removed.push(flatNativeTargetPath);
      } else {
        conflicts.push({
          name: source.name,
          sourcePath: source.sourceRelativeSkillPath,
          targetPath: flatNativeTargetPath,
        });
        continue;
      }
    }
    const targetManaged = previous?.targetPath === source.targetRelativeSkillPath;
    const targetExists = await exists(source.targetSkillPath);
    const targetDirExists = await exists(source.targetDir);
    if (targetDirExists && !targetManaged && !(await isOpenOneManagedSkillCandidate(source.targetSkillPath))) {
      conflicts.push({
        name: source.name,
        sourcePath: source.sourceRelativeSkillPath,
        targetPath: source.targetRelativeSkillPath,
      });
      continue;
    }

    if (previous && previous.targetPath !== source.targetRelativeSkillPath) {
      const previousTargetSkillPath = join(root, fromWorkspaceRelativePath(previous.targetPath));
      if (await exists(previousTargetSkillPath)) {
        await rm(dirname(previousTargetSkillPath), { recursive: true, force: true });
        removed.push(previous.targetPath);
      }
    }

    const sourceHash = await hashPluginSkillSource(source);
    const needsManagedRefresh = targetExists && await targetNeedsManagedRefresh(source.targetSkillPath);
    const needsWrite =
      !targetExists ||
      needsManagedRefresh ||
      previous?.sourcePath !== source.sourceRelativeSkillPath ||
      previous?.sourceHash !== sourceHash;

    if (needsWrite) {
      await rm(source.targetDir, { recursive: true, force: true });
      await mkdir(dirname(source.targetDir), { recursive: true });
      await cp(source.sourceDir, source.targetDir, { recursive: true });
      await syncPluginSharedDirectory(source);
      await writeFile(source.targetSkillPath, managedSkillContent(await readFile(source.sourceSkillPath, "utf8"), source), "utf8");
      written.push(source.targetRelativeSkillPath);
    }

    nextSkills[source.name] = {
      sourcePath: source.sourceRelativeSkillPath,
      targetPath: source.targetRelativeSkillPath,
      sourceHash,
      updatedAt: needsWrite ? Date.now() : previous?.updatedAt ?? Date.now(),
    };
  }

  for (const [name, entry] of Object.entries(manifest.skills)) {
    if (nextSkills[name]) continue;
    const targetSkillPath = join(root, fromWorkspaceRelativePath(entry.targetPath));
    if (await exists(targetSkillPath)) {
      await rm(dirname(targetSkillPath), { recursive: true, force: true });
      removed.push(entry.targetPath);
    }
    const namespace = managedSkillNamespace(entry.targetPath);
    if (namespace && !Object.values(nextSkills).some((next) => managedSkillNamespace(next.targetPath) === namespace)) {
      await rm(join(skillsDir, namespace, "shared"), { recursive: true, force: true });
    }
  }

  await writeManifest(manifestPath, { version: 1, skills: nextSkills });
  return { written, removed, conflicts };
}

export function managedOpenCodeSkillConflictWarnings(result: ManagedOpenCodeSkillSyncResult): string[] {
  return result.conflicts.map((conflict) =>
    `Skill ${conflict.name} was installed, but Open One did not overwrite existing ${conflict.targetPath}. Remove or rename that skill to let OpenCode load the plugin-managed version.`,
  );
}

async function migrateLegacyPluginSkills(root: string, skillsDir: string, pluginsDir: string, manifest: ManagedSkillManifest): Promise<void> {
  if (!(await exists(skillsDir)) || !(await exists(pluginsDir))) return;
  const entries = await readDirectories(skillsDir);
  for (const entry of entries) {
    const namespaceDir = join(skillsDir, entry.name);
    if (await exists(join(namespaceDir, "SKILL.md"))) continue;
    const pluginRootDir = join(pluginsDir, entry.name);
    if (!(await exists(pluginRootDir))) continue;
    const subEntries = await readDirectories(namespaceDir);
    for (const subEntry of subEntries) {
      const sourceDir = join(namespaceDir, subEntry.name);
      const sourceSkillPath = join(sourceDir, "SKILL.md");
      if (!(await exists(sourceSkillPath))) continue;
      const sourceRelativeSkillPath = toWorkspaceRelativePath(root, sourceSkillPath);
      if (Object.values(manifest.skills).some((skill) => skill.targetPath === sourceRelativeSkillPath)) continue;
      const targetDir = join(pluginRootDir, "skills", subEntry.name);
      if (await exists(join(targetDir, "SKILL.md"))) continue;
      await mkdir(dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true });
    }
  }
}

async function migrateLegacyPluginFiles(nativeDir: string, pluginsDir: string, pluginSubdir: "agents" | "commands"): Promise<void> {
  if (!(await exists(nativeDir)) || !(await exists(pluginsDir))) return;
  const entries = await readDirectories(nativeDir);
  for (const entry of entries) {
    const namespaceDir = join(nativeDir, entry.name);
    const pluginRootDir = join(pluginsDir, entry.name);
    if (!(await exists(pluginRootDir))) continue;
    const sourceFiles = await listDirectoryFiles(namespaceDir);
    for (const sourceFile of sourceFiles) {
      const targetFile = join(pluginRootDir, pluginSubdir, relative(namespaceDir, sourceFile));
      if (await exists(targetFile)) continue;
      await mkdir(dirname(targetFile), { recursive: true });
      await cp(sourceFile, targetFile);
    }
  }
}

async function listPluginSkillSources(root: string, skillsDir: string, pluginsDir: string): Promise<PluginSkillSource[]> {
  const result: PluginSkillSource[] = [];

  if (await exists(pluginsDir)) {
    const pluginEntries = await readDirectories(pluginsDir);
    for (const pluginEntry of pluginEntries) {
      const pluginRootDir = join(pluginsDir, pluginEntry.name);
      const pluginSkillsDir = join(pluginRootDir, "skills");
      const pluginSharedDir = join(pluginRootDir, "shared");
      const subEntries = await readDirectories(pluginSkillsDir);
      for (const subEntry of subEntries) {
        const sourceDir = join(pluginSkillsDir, subEntry.name);
        const sourceSkillPath = join(sourceDir, "SKILL.md");
        if (!(await exists(sourceSkillPath))) continue;
        const name = await readValidSkillName(sourceSkillPath, subEntry.name);
        if (!name) continue;
        result.push(skillSource(root, skillsDir, pluginEntry.name, name, sourceDir, sourceSkillPath, pluginRootDir, await exists(pluginSharedDir) ? pluginSharedDir : null));
      }
    }
  }

  if (!(await exists(skillsDir))) return result;
  const entries = await readDirectories(skillsDir);
  for (const entry of entries) {
    const namespaceDir = join(skillsDir, entry.name);
    if (await exists(join(namespaceDir, "SKILL.md"))) continue;
    if (await exists(join(pluginsDir, entry.name, "skills"))) continue;
    const subEntries = await readDirectories(namespaceDir);
    for (const subEntry of subEntries) {
      const sourceDir = join(namespaceDir, subEntry.name);
      const sourceSkillPath = join(sourceDir, "SKILL.md");
      if (!(await exists(sourceSkillPath))) continue;
      const name = await readValidSkillName(sourceSkillPath, subEntry.name);
      if (!name) continue;
      const pluginRootDir = await exists(join(pluginsDir, entry.name)) ? join(pluginsDir, entry.name) : null;
      const pluginSharedDir = pluginRootDir && await exists(join(pluginRootDir, "shared")) ? join(pluginRootDir, "shared") : null;
      result.push(skillSource(root, skillsDir, pluginRootDir ? entry.name : null, name, sourceDir, sourceSkillPath, pluginRootDir, pluginSharedDir));
    }
  }
  return result;
}

function skillSource(
  root: string,
  skillsDir: string,
  namespace: string | null,
  name: string,
  sourceDir: string,
  sourceSkillPath: string,
  pluginRootDir: string | null,
  pluginSharedDir: string | null,
): PluginSkillSource {
  const targetBaseDir = namespace ? join(skillsDir, namespace) : skillsDir;
  const targetDir = join(targetBaseDir, name);
  const targetSharedDir = namespace && pluginSharedDir ? join(targetBaseDir, "shared") : null;
  return {
    name,
    namespace,
    sourceDir,
    sourceSkillPath,
    sourceRelativeSkillPath: toWorkspaceRelativePath(root, sourceSkillPath),
    pluginRootDir,
    pluginSharedDir,
    targetSharedDir,
    targetDir,
    targetSkillPath: join(targetDir, "SKILL.md"),
    targetRelativeSkillPath: toWorkspaceRelativePath(root, join(targetDir, "SKILL.md")),
  };
}

function managedSkillContent(content: string, source: PluginSkillSource): string {
  const note = [
    "> Open One generated this native OpenCode skill entry from a plugin runtime path.",
    `> Runtime skill dir: \`${source.sourceDir}\`.`,
    ...(source.pluginRootDir ? [`> Plugin root: \`${source.pluginRootDir}\`.`] : []),
    ...(source.pluginSharedDir ? [`> Plugin shared dir: \`${source.pluginSharedDir}\`.`] : []),
    "",
  ].join("\n");
  const replaced = replacePluginPathTokens(stripGeneratedOpenOneSupportNotes(content), source);
  return insertAfterFrontmatter(replaced, note);
}

function replacePluginPathTokens(content: string, source: PluginSkillSource): string {
  let replaced = content
    .replaceAll("<SKILL_DIR>", source.sourceDir)
    .replaceAll("<PLUGIN_ROOT>", source.pluginRootDir ?? "<PLUGIN_ROOT>")
    .replaceAll("<PLUGIN_SHARED_DIR>", source.pluginSharedDir ?? "<PLUGIN_SHARED_DIR>");
  if (source.pluginRootDir) {
    replaced = replaced.replace(/<[A-Z0-9_]+_PLUGIN_ROOT>/g, source.pluginRootDir);
  }
  if (source.pluginSharedDir) {
    replaced = replaced.replace(/<[A-Z0-9_]+_SHARED_DIR>/g, source.pluginSharedDir);
  }
  return replaced;
}

function stripGeneratedOpenOneSupportNotes(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(
      /(?:^|\n)> Open One installed this (?:Claude )?plugin's (?:support|runtime) files under\n> `[^\n]+`\.[^\n]*\n(?:> SAP Dev compatibility: treat `[^\n]+` as\n> `[^\n]+`\.\n)?\n?/g,
      "\n",
    );
}

function insertAfterFrontmatter(content: string, note: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return `${note}${normalized}`;
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return `${note}${normalized}`;
  const afterFence = normalized.indexOf("\n", end + 4);
  if (afterFence === -1) return `${normalized}\n\n${note}`;
  return `${normalized.slice(0, afterFence + 1)}\n${note}${normalized.slice(afterFence + 1)}`;
}

async function readValidSkillName(skillPath: string, entryName: string): Promise<string | null> {
  try {
    const content = await readFile(skillPath, "utf8");
    const { data } = parseFrontmatter(content);
    const name = typeof data.name === "string" ? data.name.trim() : entryName;
    validateSkillName(name);
    return name === entryName ? name : null;
  } catch {
    return null;
  }
}

async function readDirectories(dir: string): Promise<Dirent[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
}

async function isOpenOneManagedSkillCandidate(skillPath: string): Promise<boolean> {
  if (!(await exists(skillPath))) return false;
  try {
    const content = await readFile(skillPath, "utf8");
    return content.includes("Open One generated this native OpenCode skill entry")
      || content.includes("Open One installed this plugin's runtime files under")
      || content.includes("Open One installed this Claude plugin's support files under");
  } catch {
    return false;
  }
}

async function targetNeedsManagedRefresh(skillPath: string): Promise<boolean> {
  try {
    const content = await readFile(skillPath, "utf8");
    return !content.includes("Open One generated this native OpenCode skill entry")
      || content.includes("Open One installed this plugin's runtime files under")
      || content.includes("Open One installed this Claude plugin's support files under")
      || content.includes("SAP Dev compatibility");
  } catch {
    return true;
  }
}

async function hashDirectory(dir: string): Promise<string> {
  const hash = createHash("sha256");
  const files = await listDirectoryFiles(dir);
  for (const file of files) {
    hash.update(toWorkspaceRelativePath(dir, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function hashPluginSkillSource(source: PluginSkillSource): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await hashDirectory(source.sourceDir));
  if (source.pluginSharedDir) {
    hash.update("\0plugin-shared\0");
    hash.update(await hashDirectory(source.pluginSharedDir));
  }
  return hash.digest("hex");
}

async function syncPluginSharedDirectory(source: PluginSkillSource): Promise<void> {
  if (!source.pluginSharedDir || !source.targetSharedDir) return;
  await rm(source.targetSharedDir, { recursive: true, force: true });
  await mkdir(dirname(source.targetSharedDir), { recursive: true });
  await cp(source.pluginSharedDir, source.targetSharedDir, { recursive: true });
}

async function listDirectoryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listDirectoryFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

async function readManifest(path: string): Promise<ManagedSkillManifest> {
  if (!(await exists(path))) return { version: 1, skills: {} };
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.skills)) return { version: 1, skills: {} };
    const skills: Record<string, ManagedSkillEntry> = {};
    for (const [name, value] of Object.entries(parsed.skills)) {
      if (!isRecord(value)) continue;
      const sourcePath = readString(value.sourcePath);
      const targetPath = readString(value.targetPath);
      const sourceHash = readString(value.sourceHash);
      const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0;
      if (!sourcePath || !targetPath || !sourceHash) continue;
      skills[name] = { sourcePath, targetPath, sourceHash, updatedAt };
    }
    return { version: 1, skills };
  } catch {
    return { version: 1, skills: {} };
  }
}

async function writeManifest(path: string, manifest: ManagedSkillManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function toWorkspaceRelativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

function fromWorkspaceRelativePath(path: string): string {
  return join(...path.split("/"));
}

function managedSkillNamespace(targetPath: string): string | null {
  const parts = targetPath.split("/").filter(Boolean);
  if (parts.length < 5) return null;
  if (parts[0] !== ".opencode" || parts[1] !== "skills" || parts.at(-1) !== "SKILL.md") return null;
  return parts[2] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

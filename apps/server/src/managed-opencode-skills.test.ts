import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { syncManagedOpenCodeSkills } from "./managed-opencode-skills.js";
import { listSkills } from "./skills.js";
import { exists } from "./utils.js";

async function withWorkspace(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "openwork-managed-skills-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writePluginSkill(root: string) {
  const skillDir = join(root, ".opencode", "plugins", "acme-plugin", "skills", "do-thing");
  const sharedScript = join(root, ".opencode", "plugins", "acme-plugin", "shared", "scripts", "helper.ps1");
  await mkdir(skillDir, { recursive: true });
  await mkdir(join(root, ".opencode", "plugins", "acme-plugin", "shared", "scripts"), { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: do-thing",
      "description: Test plugin skill",
      "---",
      "",
      "Use `<ACME_SHARED_DIR>` and `<PLUGIN_SHARED_DIR>` for helper scripts.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(skillDir, "run.ps1"), "$shared = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'shared\\scripts'\n", "utf8");
  await writeFile(sharedScript, "Write-Output helper\n", "utf8");
}

describe("syncManagedOpenCodeSkills", () => {
  test("materializes plugin skills as flat native OpenCode skills", async () => {
    await withWorkspace(async (root) => {
      await writePluginSkill(root);

      const result = await syncManagedOpenCodeSkills(root);
      const materializedSkillPath = join(root, ".opencode", "skills", "do-thing", "SKILL.md");
      const materializedHelperPath = join(root, ".opencode", "skills", "shared", "scripts", "helper.ps1");
      const pluginSharedDir = join(root, ".opencode", "plugins", "acme-plugin", "shared");

      expect(result.conflicts).toEqual([]);
      expect(result.written).toEqual([".opencode/skills/do-thing/SKILL.md"]);
      expect(await exists(materializedHelperPath)).toBe(false);
      const content = await readFile(materializedSkillPath, "utf8");
      expect(content).toContain(pluginSharedDir);
      expect(content).not.toContain("<ACME_SHARED_DIR>");
      expect(content).not.toContain("<PLUGIN_SHARED_DIR>");
      const skills = await listSkills(root, false);
      expect(skills.map((skill) => skill.name)).toContain("do-thing");
    });
  });

  test("does not shadow a user-owned flat native skill", async () => {
    await withWorkspace(async (root) => {
      await writePluginSkill(root);
      const flatSkillPath = join(root, ".opencode", "skills", "do-thing", "SKILL.md");
      await mkdir(join(root, ".opencode", "skills", "do-thing"), { recursive: true });
      await writeFile(flatSkillPath, "---\nname: do-thing\ndescription: User owned\n---\n\nManual skill\n", "utf8");

      const result = await syncManagedOpenCodeSkills(root);

      expect(result.written).toEqual([]);
      expect(result.conflicts).toEqual([{
        name: "do-thing",
        sourcePath: ".opencode/plugins/acme-plugin/skills/do-thing/SKILL.md",
        targetPath: ".opencode/skills/do-thing/SKILL.md",
      }]);
      expect(await readFile(flatSkillPath, "utf8")).toContain("Manual skill");
    });
  });

  test("refreshes an old Open One flat managed skill in place", async () => {
    await withWorkspace(async (root) => {
      await writePluginSkill(root);
      const oldFlatSkillPath = join(root, ".opencode", "skills", "do-thing", "SKILL.md");
      await mkdir(join(root, ".opencode", "skills", "do-thing"), { recursive: true });
      await mkdir(join(root, ".opencode", "openone"), { recursive: true });
      await writeFile(oldFlatSkillPath, "---\nname: do-thing\ndescription: Old managed copy\n---\n\nOld copy\n", "utf8");
      await writeFile(
        join(root, ".opencode", "openone", "managed-skills.json"),
        `${JSON.stringify({
          version: 1,
          skills: {
            "do-thing": {
              sourcePath: ".opencode/plugins/acme-plugin/skills/do-thing/SKILL.md",
              targetPath: ".opencode/skills/do-thing/SKILL.md",
              sourceHash: "old",
              updatedAt: 1,
            },
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await syncManagedOpenCodeSkills(root);

      expect(result.removed).toEqual([]);
      expect(await exists(join(root, ".opencode", "skills", "do-thing", "SKILL.md"))).toBe(true);
      expect(await exists(join(root, ".opencode", "skills", "acme-plugin", "do-thing", "SKILL.md"))).toBe(false);
    });
  });

  test("adopts an old Open One namespaced skill copy without a manifest", async () => {
    await withWorkspace(async (root) => {
      await writePluginSkill(root);
      const oldNamespacedSkillPath = join(root, ".opencode", "skills", "acme-plugin", "do-thing", "SKILL.md");
      await mkdir(join(root, ".opencode", "skills", "acme-plugin", "do-thing"), { recursive: true });
      await writeFile(
        oldNamespacedSkillPath,
        [
          "---",
          "name: do-thing",
          "description: Old Open One copy",
          "---",
          "",
          "> Open One installed this Claude plugin's support files under",
          "> `.opencode/plugins/acme-plugin`.",
          "",
          "Old copy",
        ].join("\n"),
        "utf8",
      );

      const result = await syncManagedOpenCodeSkills(root);

      expect(result.conflicts).toEqual([]);
      expect(result.written).toEqual([".opencode/skills/do-thing/SKILL.md"]);
      const content = await readFile(join(root, ".opencode", "skills", "do-thing", "SKILL.md"), "utf8");
      expect(content).toContain("Open One generated this native OpenCode skill entry");
      expect(content).not.toContain("Open One installed this Claude plugin's support files under");
      expect(content).not.toContain("SAP Dev compatibility");
      expect(content).not.toContain("Old copy");
    });
  });

  test("removes legacy namespaced shared mirrors when migrating tracked plugin skills", async () => {
    await withWorkspace(async (root) => {
      await writePluginSkill(root);
      const oldNamespacedSkillPath = join(root, ".opencode", "skills", "acme-plugin", "do-thing", "SKILL.md");
      const oldSharedPath = join(root, ".opencode", "skills", "acme-plugin", "shared", "scripts", "helper.ps1");
      await mkdir(join(root, ".opencode", "skills", "acme-plugin", "do-thing"), { recursive: true });
      await mkdir(dirname(oldSharedPath), { recursive: true });
      await mkdir(join(root, ".opencode", "openone"), { recursive: true });
      await writeFile(oldNamespacedSkillPath, "---\nname: do-thing\ndescription: Old managed copy\n---\n\nOld copy\n", "utf8");
      await writeFile(oldSharedPath, "Old shared copy\n", "utf8");
      await writeFile(
        join(root, ".opencode", "openone", "managed-skills.json"),
        `${JSON.stringify({
          version: 1,
          skills: {
            "do-thing": {
              sourcePath: ".opencode/plugins/acme-plugin/skills/do-thing/SKILL.md",
              targetPath: ".opencode/skills/acme-plugin/do-thing/SKILL.md",
              sourceHash: "old",
              updatedAt: 1,
            },
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await syncManagedOpenCodeSkills(root);

      expect(result.removed).toContain(".opencode/skills/acme-plugin/do-thing/SKILL.md");
      expect(result.removed).toContain(".opencode/skills/acme-plugin/shared");
      expect(await exists(join(root, ".opencode", "skills", "do-thing", "SKILL.md"))).toBe(true);
      expect(await exists(oldSharedPath)).toBe(false);
    });
  });

  test("removes legacy plugin shared mirrors even after the manifest is already flat", async () => {
    await withWorkspace(async (root) => {
      await writePluginSkill(root);
      const oldSharedPath = join(root, ".opencode", "skills", "acme-plugin", "shared", "scripts", "helper.ps1");
      await mkdir(dirname(oldSharedPath), { recursive: true });
      await writeFile(oldSharedPath, "Old shared copy\n", "utf8");
      await mkdir(join(root, ".opencode", "openone"), { recursive: true });
      await writeFile(
        join(root, ".opencode", "openone", "managed-skills.json"),
        `${JSON.stringify({
          version: 1,
          skills: {
            "do-thing": {
              sourcePath: ".opencode/plugins/acme-plugin/skills/do-thing/SKILL.md",
              targetPath: ".opencode/skills/do-thing/SKILL.md",
              sourceHash: "old",
              updatedAt: 1,
            },
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await syncManagedOpenCodeSkills(root);

      expect(result.removed).toContain(".opencode/skills/acme-plugin/shared");
      expect(await exists(join(root, ".opencode", "skills", "do-thing", "SKILL.md"))).toBe(true);
      expect(await exists(oldSharedPath)).toBe(false);
    });
  });

  test("refreshes a managed skill when the generated wrapper format changes", async () => {
    await withWorkspace(async (root) => {
      await writePluginSkill(root);
      await syncManagedOpenCodeSkills(root);
      const managedSkillPath = join(root, ".opencode", "skills", "do-thing", "SKILL.md");
      await writeFile(
        managedSkillPath,
        [
          "---",
          "name: do-thing",
          "description: Old managed copy",
          "---",
          "",
          "> Open One generated this native OpenCode skill entry from a plugin runtime path.",
          "> Open One installed this Claude plugin's support files under",
          "> `.opencode/plugins/acme-plugin`.",
          "",
          "Old managed content",
        ].join("\n"),
        "utf8",
      );

      const result = await syncManagedOpenCodeSkills(root);

      expect(result.written).toEqual([".opencode/skills/do-thing/SKILL.md"]);
      const content = await readFile(managedSkillPath, "utf8");
      expect(content).not.toContain("Open One installed this Claude plugin's support files under");
      expect(content).not.toContain("Old managed content");
    });
  });
});

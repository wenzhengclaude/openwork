import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  commandMatchesPackagedSidecar,
  embeddedServerImportUrl,
  prioritizeWorkspacePaths,
  resolveBundledAgentCommandEnv,
  resolveOpenworkServerConfigPath,
  seedWorkspacePathsForEmbeddedServer,
  selectStickyOpenworkPortWorkspace,
} from "./runtime.mjs";

describe("prioritizeWorkspacePaths", () => {
  it("keeps the active runtime workspace first", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current", ["/workspace/other", "/workspace/current"]),
      ["/workspace/current", "/workspace/other"],
    );
  });

  it("dedupes equivalent paths", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current/../current", ["/workspace/current"]),
      ["/workspace/current/../current"],
    );
  });
});

describe("seedWorkspacePathsForEmbeddedServer", () => {
  it("uses persisted server config instead of Electron workspace state once config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/legacy"], true),
      [],
    );
  });

  it("seeds from Electron workspace state before server config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/first"], false),
      ["/workspace/first"],
    );
  });
});

describe("selectStickyOpenworkPortWorkspace", () => {
  it("uses the requested workspace even when server config owns workspace loading", () => {
    assert.equal(
      selectStickyOpenworkPortWorkspace(["/workspace/current"], []),
      "/workspace/current",
    );
  });

  it("falls back to server workspace paths when no requested path is available", () => {
    assert.equal(
      selectStickyOpenworkPortWorkspace([], ["/workspace/from-server"]),
      "/workspace/from-server",
    );
  });
});

describe("commandMatchesPackagedSidecar", () => {
  it("matches packaged opencode sidecars with platform suffixes", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/Applications/OpenWork.app/Contents/Resources/sidecars/opencode-aarch64-apple-darwin serve --hostname 127.0.0.1 --port 49174 --cors *",
        ["/Applications/OpenWork.app/Contents/Resources/sidecars"],
      ),
      true,
    );
  });

  it("does not match unrelated opencode processes outside sidecar directories", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/usr/local/bin/opencode serve --hostname 127.0.0.1 --port 49174",
        ["/Applications/OpenWork.app/Contents/Resources/sidecars"],
      ),
      false,
    );
  });

  it("matches packaged agent runtime sidecars", () => {
    const sidecars = ["/Applications/OpenWork.app/Contents/Resources/sidecars"];
    assert.equal(
      commandMatchesPackagedSidecar(
        "/Applications/OpenWork.app/Contents/Resources/sidecars/codex-aarch64-apple-darwin app-server",
        sidecars,
      ),
      true,
    );
    assert.equal(
      commandMatchesPackagedSidecar(
        "/Applications/OpenWork.app/Contents/Resources/sidecars/grok-aarch64-apple-darwin agent stdio",
        sidecars,
      ),
      true,
    );
  });
});

describe("resolveBundledAgentCommandEnv", () => {
  it("points agent commands at bundled sidecars", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openwork-agent-sidecars-"));
    try {
      const ext = process.platform === "win32" ? ".exe" : "";
      const codexPath = path.join(dir, `codex${ext}`);
      const grokPath = path.join(dir, `grok${ext}`);
      await writeFile(codexPath, "");
      await writeFile(grokPath, "");

      assert.deepEqual(resolveBundledAgentCommandEnv([dir], {}), {
        OPENONE_CODEX_COMMAND: codexPath,
        OPENONE_GROK_COMMAND: grokPath,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps explicit agent command overrides", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openwork-agent-sidecars-"));
    try {
      const ext = process.platform === "win32" ? ".exe" : "";
      await writeFile(path.join(dir, `codex${ext}`), "");
      await writeFile(path.join(dir, `grok${ext}`), "");

      assert.deepEqual(resolveBundledAgentCommandEnv([dir], {
        OPENONE_CODEX_COMMAND: "/custom/codex",
      }), {
        OPENONE_GROK_COMMAND: path.join(dir, `grok${ext}`),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("embeddedServerImportUrl", () => {
  it("returns the same file URL for unchanged metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openwork-runtime-"));
    try {
      const embeddedPath = path.join(dir, "embedded.js");
      await writeFile(embeddedPath, "export const value = 1;\n");

      const first = embeddedServerImportUrl(embeddedPath);
      const second = embeddedServerImportUrl(embeddedPath);
      const url = new URL(first);

      assert.equal(first, second);
      assert.equal(url.protocol, "file:");
      assert.equal(fileURLToPath(url), embeddedPath);
      assert.ok(url.searchParams.get("mtimeMs"));
      assert.equal(url.searchParams.get("size"), String("export const value = 1;\n".length));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("changes when the file metadata changes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openwork-runtime-"));
    try {
      const embeddedPath = path.join(dir, "embedded.js");
      await writeFile(embeddedPath, "export const value = 1;\n");
      const first = embeddedServerImportUrl(embeddedPath);

      await writeFile(embeddedPath, "export const value = 12;\n");

      assert.notEqual(embeddedServerImportUrl(embeddedPath), first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the plain file URL if stat fails", () => {
    const missingPath = path.join(os.tmpdir(), "openwork-missing-embedded.js");

    assert.equal(embeddedServerImportUrl(missingPath), pathToFileURL(missingPath).href);
  });
});

describe("resolveOpenworkServerConfigPath", () => {
  it("respects explicit server config path", () => {
    const explicitPath = path.resolve("/tmp/openwork/server.json");
    assert.equal(
      resolveOpenworkServerConfigPath({ OPENWORK_SERVER_CONFIG: explicitPath }),
      explicitPath,
    );
  });

  it("uses XDG config home on Unix", () => {
    if (process.platform === "win32") return;
    assert.equal(
      resolveOpenworkServerConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" }),
      "/tmp/xdg/openwork/server.json",
    );
  });
});

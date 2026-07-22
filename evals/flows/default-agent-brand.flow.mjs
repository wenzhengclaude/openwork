async function ensureSessionRoute(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API",
  });
  await ctx.control("route.session").catch(async () => {
    await ctx.navigateHash("/session");
  });
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after session route",
  });
}

function runtimePromptStateScript() {
  return `(async () => {
    try {
      const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
      const route = window.__openworkControl.snapshot().route;
      const match = /^\\/workspace\\/([^/]+)/.exec(route);
      let workspaceId = match?.[1] ? decodeURIComponent(match[1]) : "";
      if (!info?.baseUrl) {
        return { ok: false, error: "missing server info", route, workspaceId, hasInfo: Boolean(info) };
      }
      const token = (info.ownerToken || info.clientToken || "").trim();
      if (!token) return { ok: false, error: "missing server token", route, workspaceId };
      const baseUrl = info.baseUrl.replace(/\\/+$/, "");
      if (!workspaceId) {
        const workspaceResponse = await fetch(baseUrl + "/workspaces", {
          headers: { Authorization: "Bearer " + token },
        });
        const workspaceText = await workspaceResponse.text();
        if (!workspaceResponse.ok) {
          return { ok: false, error: "workspaces request failed", status: workspaceResponse.status, body: workspaceText.slice(0, 300) };
        }
        const workspacePayload = JSON.parse(workspaceText);
        workspaceId = workspacePayload.activeId || workspacePayload.items?.[0]?.id || workspacePayload.workspaces?.[0]?.id || "";
      }
      if (!workspaceId) return { ok: false, error: "missing workspace", route };
      const url = [
        baseUrl,
        "workspace",
        encodeURIComponent(workspaceId),
        "runtime-config",
      ].join("/");
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
      });
      const text = await response.text();
      if (!response.ok) {
        return { ok: false, error: "runtime-config request failed", status: response.status, body: text.slice(0, 300) };
      }
      const payload = JSON.parse(text);
      const agent = payload.effectiveRuntime?.agent?.openwork ?? payload.sources?.injected?.config?.agent?.openwork ?? {};
      const prompt = typeof agent.prompt === "string" ? agent.prompt : "";
      return {
        ok: true,
        route,
        workspaceId,
        firstLine: prompt.split("\\n")[0],
        hasOldIdentity: prompt.includes("You are OpenWork."),
        description: agent.description ?? "",
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })()`;
}

export default {
  id: "default-agent-brand",
  title: "Default agent identifies as Open One",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const route = await ctx.eval("window.__openworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "Profile is not onboarded; default agent brand validation requires a workspace."
      : null;
  },
  steps: [
    {
      name: "Runtime prompt uses the Open One brand",
      run: async (ctx) => {
        await ensureSessionRoute(ctx);
        const state = await ctx.eval(runtimePromptStateScript(), { awaitPromise: true });
        ctx.assert(state.ok === true, `Could not read runtime prompt: ${JSON.stringify(state)}`);
        ctx.assert(state.firstLine === "You are Open One.", `Unexpected default agent identity: ${state.firstLine}`);
        ctx.assert(state.hasOldIdentity === false, "Default agent prompt still contains the old OpenWork identity.");
        ctx.assert(state.description === "Open One default agent", `Unexpected default agent description: ${state.description}`);

        await ctx.screenshot("default-agent-brand", {
          claim: "The active workspace runtime config injects the default agent as Open One, not OpenWork.",
          voiceover: "The app keeps the Open One brand consistent all the way into the default agent prompt.",
          hashIncludes: "/workspace/",
        });
      },
    },
  ],
};

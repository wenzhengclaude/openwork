async function ensureSessionRoute(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API",
  });
  await ctx.control("route.session").catch(async () => {
    await ctx.navigateHash("/session");
  });
  await ctx.waitFor(
    "window.__openworkControl.listActions().some((action) => action.id === 'session.create_task' && !action.disabled)",
    { timeoutMs: 60_000, label: "session create action" },
  );
}

function routeInfoExpression() {
  return `(() => {
    const route = window.__openworkControl.snapshot().route;
    const workspaceMatch = /^\\/workspace\\/([^/]+)/.exec(route);
    const sessionMatch = /\\/session\\/([^/?#]+)/.exec(route);
    return {
      route,
      workspaceId: workspaceMatch?.[1] ? decodeURIComponent(workspaceMatch[1]) : localStorage.getItem("openwork.react.activeWorkspace") || "",
      sessionId: sessionMatch?.[1] ? decodeURIComponent(sessionMatch[1]) : "",
    };
  })()`;
}

async function createSession(ctx, previousSessionId = "") {
  await ctx.control("session.create_task");
  return await ctx.waitFor(
    `(() => {
      const info = ${routeInfoExpression()};
      if (!info.sessionId || info.sessionId === ${JSON.stringify(previousSessionId)}) return null;
      return info;
    })()`,
    { timeoutMs: 60_000, label: "created session route" },
  );
}

function createAgentRunExpression(workspaceId, sessionId, prompt) {
  return `(async () => {
    const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
    if (!info?.baseUrl) return { ok: false, error: "missing Open One server baseUrl" };
    const token = (info.ownerToken || info.clientToken || "").trim();
    if (!token) return { ok: false, error: "missing Open One server token" };
    const headers = {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
    };
    if (info.hostToken) headers["X-OpenWork-Host-Token"] = info.hostToken;
    const response = await fetch(info.baseUrl.replace(/\\/+$/, "") + "/workspace/" + encodeURIComponent(${JSON.stringify(workspaceId)}) + "/agent-runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "codex",
        approvalMode: "auto-review",
        prompt: ${JSON.stringify(prompt)},
        sessionId: ${JSON.stringify(sessionId)},
        model: "gpt-5.5",
        modelProvider: "company-local",
      }),
    });
    const body = await response.text();
    const data = body ? JSON.parse(body) : {};
    return {
      ok: response.ok,
      status: response.status,
      body: body.slice(0, 500),
      baseUrl: info.baseUrl,
      token,
      hostToken: info.hostToken || "",
      runId: data.run?.id || "",
    };
  })()`;
}

function cancelAgentRunExpression(workspaceId, runId) {
  return `(async () => {
    const pending = window.__fraimzAgentRunRestore;
    if (!pending?.baseUrl || !pending?.token || !${JSON.stringify(runId)}) return true;
    const headers = { "Authorization": "Bearer " + pending.token };
    if (pending.hostToken) headers["X-OpenWork-Host-Token"] = pending.hostToken;
    await fetch(pending.baseUrl.replace(/\\/+$/, "") + "/workspace/" + encodeURIComponent(${JSON.stringify(workspaceId)}) + "/agent-runs/" + encodeURIComponent(${JSON.stringify(runId)}) + "/cancel", {
      method: "POST",
      headers,
    }).catch(() => undefined);
    return true;
  })()`;
}

export default {
  id: "agent-run-session-switch-ui",
  title: "Agent run remains visible after switching sessions",
  kind: "user-facing",
  steps: [
    {
      name: "Switching away and back restores a session-scoped Codex run",
      run: async (ctx) => {
        await ensureSessionRoute(ctx);
        const sessionA = await createSession(ctx);
        const sessionB = await createSession(ctx, sessionA.sessionId);
        ctx.assert(sessionA.workspaceId, `No workspace id for session A route: ${sessionA.route}`);
        ctx.assert(sessionA.sessionId, `No session A id for route: ${sessionA.route}`);
        ctx.assert(sessionB.sessionId, `No session B id for route: ${sessionB.route}`);

        await ctx.control("session.open", { sessionId: sessionA.sessionId });
        await ctx.waitFor(
          `window.__openworkControl.snapshot().route.includes(${JSON.stringify(`/session/${sessionA.sessionId}`)})`,
          { timeoutMs: 30_000, label: "navigated to session A" },
        );

        const prompt = `Fraimz agent run restore UI probe ${Date.now()}`;
        const created = await ctx.eval(
          createAgentRunExpression(sessionA.workspaceId, sessionA.sessionId, prompt),
          { awaitPromise: true },
        );
        ctx.assert(created?.ok === true, `Agent run creation failed: ${JSON.stringify(created)}`);
        ctx.assert(typeof created.runId === "string" && created.runId.length > 0, "Agent run id is missing.");
        await ctx.eval(`window.__fraimzAgentRunRestore = ${JSON.stringify(created)}`);

        try {
          await ctx.control("session.open", { sessionId: sessionB.sessionId });
          await ctx.waitFor(
            `window.__openworkControl.snapshot().route.includes(${JSON.stringify(`/session/${sessionB.sessionId}`)})`,
            { timeoutMs: 30_000, label: "navigated to session B" },
          );

          await ctx.control("session.open", { sessionId: sessionA.sessionId });
          await ctx.waitFor(
            `window.__openworkControl.snapshot().route.includes(${JSON.stringify(`/session/${sessionA.sessionId}`)})`,
            { timeoutMs: 30_000, label: "returned to session A" },
          );
          await ctx.waitFor(
            `document.body.textContent.includes(${JSON.stringify(prompt)}) && document.body.textContent.includes("Codex")`,
            { timeoutMs: 60_000, label: "restored Codex run text" },
          );

          await ctx.screenshot("agent-run-restored-after-session-switch", {
            claim: "After switching to another session and back, the session-scoped Codex agent run is restored into the chat timeline.",
            requireText: [prompt, "Codex"],
            hashIncludes: `/session/${sessionA.sessionId}`,
          });
        } finally {
          await ctx.eval(cancelAgentRunExpression(sessionA.workspaceId, created.runId), { awaitPromise: true }).catch(() => undefined);
        }
      },
    },
  ],
};

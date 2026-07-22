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
  await ctx.waitFor(
    "window.__openworkControl.listActions().some((action) => action.id === 'session.list_sessions')",
    { timeoutMs: 60_000, label: "session list action" },
  );
}

function routeInfoScript() {
  return `(() => {
    const route = window.__openworkControl.snapshot().route;
    const match = /^\\/workspace\\/([^/]+)(?:\\/session\\/([^/?#]+))?/.exec(route);
    return {
      route,
      workspaceId: match?.[1] ? decodeURIComponent(match[1]) : "",
      sessionId: match?.[2] ? decodeURIComponent(match[2]) : "",
    };
  })()`;
}

async function ensureOpenSession(ctx) {
  const state = await ctx.waitFor(
    `(() => {
      if (document.querySelector('[data-session-surface-id]')) return "surface";
      const action = window.__openworkControl.listActions().find((item) => item.id === "session.create_task");
      if (action && !action.disabled) return "create";
      return null;
    })()`,
    { timeoutMs: 60_000, label: "session surface or create action" },
  );

  if (state === "create") {
    await ctx.control("session.create_task").catch(async () => {
      await ctx.control("route.session");
    });
  }

  await waitForSessionSurface(ctx);
}

async function waitForSessionSurface(ctx) {
  await ctx.waitFor(
    "Boolean(document.querySelector('[data-session-surface-id]'))",
    { timeoutMs: 60_000, label: "session surface" },
  );
  await ctx.waitFor(
    "window.__openworkControl.listActions().some((action) => action.id === 'session.read_transcript')",
    { timeoutMs: 60_000, label: "session transcript action" },
  );
}

async function readTranscript(ctx) {
  return await ctx.control("session.read_transcript", { count: 30 }).catch(() => null);
}

async function seedNoReplyUserMessage(ctx) {
  await ensureOpenSession(ctx);

  const routeInfo = await ctx.eval(routeInfoScript());
  ctx.assert(routeInfo.workspaceId, `Could not resolve workspace id from route ${routeInfo.route}.`);
  ctx.assert(routeInfo.sessionId, `Could not resolve session id from route ${routeInfo.route}.`);

  const text = `Timeline UI validation message ${Date.now()}`;
  const result = await ctx.eval(
    `(async () => {
      const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
      if (!info?.baseUrl) return { ok: false, error: "missing openwork server baseUrl" };
      const token = (info.ownerToken || info.clientToken || "").trim();
      if (!token) return { ok: false, error: "missing openwork server token" };
      const url = [
        info.baseUrl.replace(/\\/+$/, ""),
        "workspace",
        encodeURIComponent(${JSON.stringify(routeInfo.workspaceId)}),
        "opencode",
        "session",
        encodeURIComponent(${JSON.stringify(routeInfo.sessionId)}),
        "prompt_async",
      ].join("/");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          noReply: true,
          parts: [{ type: "text", text: ${JSON.stringify(text)} }],
        }),
      });
      const body = await response.text();
      return { ok: response.ok, status: response.status, body: body.slice(0, 500), url };
    })()`,
    { awaitPromise: true },
  );

  ctx.assert(result?.ok !== false, `Could not seed noReply transcript message: ${JSON.stringify(result)}`);
  await ctx.navigateHash(`/workspace/${encodeURIComponent(routeInfo.workspaceId)}/session/${encodeURIComponent(routeInfo.sessionId)}`);
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after seeded transcript navigation",
  });
  await waitForSessionSurface(ctx);
  await ctx.waitFor(
    `document.body.textContent.includes(${JSON.stringify(text)})`,
    { timeoutMs: 30_000, label: "seeded noReply transcript text" },
  );
  return { sessionId: routeInfo.sessionId, source: "seeded", text };
}

async function openSessionWithUserMessage(ctx) {
  await ensureOpenSession(ctx);
  return await seedNoReplyUserMessage(ctx);
}

function timelineVisualStateScript() {
  return `(() => {
    const overlay = document.querySelector('[data-testid="conversation-timeline-overlay"]');
    const rail = document.querySelector('[data-testid="conversation-timeline-rail"]');
    const markers = Array.from(document.querySelectorAll('[data-testid="conversation-timeline-marker"]'));
    const activeMarker = markers.find((marker) => marker.getAttribute("data-active") === "true") ?? null;
    const ticks = Array.from(document.querySelectorAll('[data-testid="conversation-timeline-tick"]'));
    const activeTick = activeMarker?.querySelector('[data-testid="conversation-timeline-tick"]') ?? null;
    const preview = document.querySelector('[data-testid="conversation-timeline-preview"]');
    const continuousTrack = document.querySelector('[data-testid="conversation-timeline-track"]');
    const railRect = rail?.getBoundingClientRect();
    const activeTickRect = activeTick?.getBoundingClientRect();
    const previewRect = preview?.getBoundingClientRect();

    return {
      hasOverlay: Boolean(overlay),
      hasRail: Boolean(rail),
      markerCount: markers.length,
      tickCount: ticks.length,
      hasActiveMarker: Boolean(activeMarker),
      hasPreview: Boolean(preview),
      hasContinuousTrack: Boolean(continuousTrack),
      railWidth: railRect?.width ?? 0,
      activeTickWidth: activeTickRect?.width ?? 0,
      previewWidth: previewRect?.width ?? 0,
      previewLeftAfterRail: Boolean(previewRect && railRect && previewRect.left > railRect.left),
    };
  })()`;
}

async function hoverActiveTimelineMarker(ctx) {
  const point = await ctx.eval(`(() => {
    const marker = Array.from(document.querySelectorAll('[data-testid="conversation-timeline-marker"]'))
      .find((item) => item.getAttribute("data-active") === "true")
      ?? document.querySelector('[data-testid="conversation-timeline-marker"]');
    if (!marker) return null;
    const rect = marker.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  ctx.assert(point !== null, "Could not locate a timeline marker to hover.");
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
}

export default {
  id: "session-timeline-conversation",
  title: "Session transcript uses a Codex-style conversation timeline",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const state = await ctx.eval(
      `(() => {
        const route = window.__openworkControl.snapshot().route;
        if (route.startsWith("/welcome") || route.startsWith("/signin")) return "blocked";
        return "ready";
      })()`,
    );
    return state === "blocked"
      ? "Profile is not onboarded; conversation timeline requires a workspace."
      : null;
  },
  steps: [
    {
      name: "Transcript messages render on a left timeline rail",
      run: async (ctx) => {
        await ensureSessionRoute(ctx);
        const opened = await openSessionWithUserMessage(ctx);
        ctx.assert(opened !== null, "No session with a user message was available for timeline validation.");

        await ctx.waitFor(
          "Boolean(document.querySelector('[data-testid=\"conversation-timeline-marker\"]'))",
          { timeoutMs: 30_000, label: "conversation timeline marker" },
        );

        const resting = await ctx.eval(timelineVisualStateScript());
        ctx.assert(resting.hasOverlay, "The conversation timeline overlay was not rendered.");
        ctx.assert(resting.hasRail, "The conversation timeline rail was not rendered.");
        ctx.assert(resting.markerCount > 0, "The timeline did not render any message markers.");
        ctx.assert(resting.tickCount === resting.markerCount, "The timeline should render each marker as a short tick.");
        ctx.assert(resting.hasActiveMarker, "The timeline did not mark the active message.");
        ctx.assert(resting.hasPreview === false, "The timeline preview should be hidden until hover.");
        ctx.assert(resting.hasContinuousTrack === false, "The timeline should not render a continuous vertical rail.");
        ctx.assert(resting.activeTickWidth > 0 && resting.activeTickWidth <= 18, `The active timeline tick should stay compact, got ${resting.activeTickWidth}.`);
        ctx.assert(resting.railWidth >= 40, `Timeline hover rail is too narrow: ${resting.railWidth}.`);

        await ctx.screenshot("session-timeline-resting", {
          claim: "At rest the transcript only shows compact left-side tick marks; no preview card is visible.",
          voiceover: "The Codex-style timeline stays quiet by default, showing only short ticks and the active dark tick.",
          hashIncludes: "/session/",
        });

        await hoverActiveTimelineMarker(ctx);
        await ctx.waitFor(
          "Boolean(document.querySelector('[data-testid=\"conversation-timeline-preview\"]'))",
          { timeoutMs: 10_000, label: "hover timeline preview" },
        );
        const hovered = await ctx.eval(timelineVisualStateScript());
        ctx.assert(hovered.hasPreview === true, "The timeline preview did not appear on hover.");
        ctx.assert(hovered.previewWidth >= 260, `Timeline preview is too narrow: ${hovered.previewWidth}.`);
        ctx.assert(hovered.previewLeftAfterRail, "Timeline preview should open to the right of the rail.");

        await ctx.screenshot("session-timeline-conversation", {
          claim: "Hovering a timeline marker reveals the floating conversation preview card.",
          voiceover: "Moving the mouse over a timeline marker reveals a floating preview card for that message, matching the Codex interaction.",
          hashIncludes: "/session/",
        });
      },
    },
  ],
};

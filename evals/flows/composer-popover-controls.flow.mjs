async function ensureComposer(ctx) {
  await ctx.navigateHash("/session");
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after returning to session route",
  });

  const state = await ctx.waitFor(
    `(() => {
      if (document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')) return "ready";
      const action = window.__openworkControl.listActions().find((item) => item.id === "session.create_task");
      if (action && !action.disabled) return "create";
      return null;
    })()`,
    { timeoutMs: 60_000, label: "composer ready or create task available" },
  );

  if (state === "create") {
    await ctx.control("session.create_task");
  }

  await ctx.waitFor("Boolean(document.querySelector('[contenteditable=\"true\"][data-lexical-editor=\"true\"]'))", {
    timeoutMs: 60_000,
    label: "composer editor",
  });
}

async function openMenu(ctx, buttonTestId, menuTestId) {
  await ctx.eval(`document.querySelector('[data-testid="${buttonTestId}"]')?.click()`);
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="${menuTestId}"]'))`, {
    timeoutMs: 10_000,
    label: `${menuTestId} visible`,
  });

  const state = await ctx.eval(`(() => {
    const button = document.querySelector('[data-testid="${buttonTestId}"]');
    const menu = document.querySelector('[data-testid="${menuTestId}"]');
    if (!(button instanceof HTMLElement) || !(menu instanceof HTMLElement)) {
      return { ok: false, reason: "missing element" };
    }
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const x = menuRect.left + Math.min(menuRect.width - 2, Math.max(2, menuRect.width / 2));
    const y = menuRect.top + Math.min(menuRect.height - 2, Math.max(2, 16));
    const hit = document.elementFromPoint(x, y);
    return {
      ok: true,
      menuWidth: menuRect.width,
      menuHeight: menuRect.height,
      menuBottom: menuRect.bottom,
      buttonTop: buttonRect.top,
      hitInsideMenu: Boolean(hit && menu.contains(hit)),
    };
  })()`);

  ctx.assert(state.ok === true, `${menuTestId} was not available: ${JSON.stringify(state)}`);
  ctx.assert(state.menuWidth > 80 && state.menuHeight > 40, `${menuTestId} is too small: ${JSON.stringify(state)}`);
  ctx.assert(state.menuBottom <= state.buttonTop + 1, `${menuTestId} should open above its button: ${JSON.stringify(state)}`);
  ctx.assert(state.hitInsideMenu === true, `${menuTestId} exists but is clipped or covered: ${JSON.stringify(state)}`);
}

async function closeMenu(ctx, buttonTestId, menuTestId) {
  const point = await ctx.waitFor(`(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
    const fallback = document.body.getBoundingClientRect();
    const rect = editor instanceof HTMLElement ? editor.getBoundingClientRect() : fallback;
    return {
      x: Math.max(16, rect.left + 16),
      y: Math.max(16, rect.top + 16),
    };
  })()`, {
    timeoutMs: 10_000,
    label: `outside point for closing ${menuTestId}`,
  });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await ctx.waitFor(`!document.querySelector('[data-testid="${menuTestId}"]')`, {
    timeoutMs: 10_000,
    label: `${menuTestId} closed`,
  });
}

async function hoverElement(ctx, selector, label) {
  const point = await ctx.waitFor(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  })()`, {
    timeoutMs: 10_000,
    label,
  });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
}

async function openContextTooltip(ctx) {
  await hoverElement(ctx, '[data-testid="composer-context-window-indicator"]', "context window indicator");
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="composer-context-window-tooltip"]'))`, {
    timeoutMs: 10_000,
    label: "context window tooltip visible",
  });

  const state = await ctx.eval(`(() => {
    const trigger = document.querySelector('[data-testid="composer-context-window-indicator"]');
    const tooltip = document.querySelector('[data-testid="composer-context-window-tooltip"]');
    if (!(trigger instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) {
      return { ok: false, reason: "missing element" };
    }
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const x = tooltipRect.left + Math.min(tooltipRect.width - 2, Math.max(2, tooltipRect.width / 2));
    const y = tooltipRect.top + Math.min(tooltipRect.height - 2, Math.max(2, tooltipRect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      ok: true,
      tooltipWidth: tooltipRect.width,
      tooltipHeight: tooltipRect.height,
      tooltipBottom: tooltipRect.bottom,
      triggerTop: triggerRect.top,
      hitInsideTooltip: Boolean(hit && tooltip.contains(hit)),
      text: tooltip.textContent ?? "",
    };
  })()`);

  ctx.assert(state.ok === true, `context tooltip was not available: ${JSON.stringify(state)}`);
  ctx.assert(state.tooltipWidth > 80 && state.tooltipHeight > 24, `context tooltip is too small: ${JSON.stringify(state)}`);
  ctx.assert(state.tooltipBottom <= state.triggerTop + 8, `context tooltip should open above the indicator: ${JSON.stringify(state)}`);
  ctx.assert(state.hitInsideTooltip === true, `context tooltip exists but is clipped or covered: ${JSON.stringify(state)}`);
  ctx.assert(state.text.includes("上下文窗口"), `context tooltip text is missing: ${JSON.stringify(state)}`);
}

export default {
  id: "composer-popover-controls",
  title: "Composer popover controls are not clipped",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const route = await ctx.eval("window.__openworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "Profile is not onboarded; composer popover controls require a workspace."
      : null;
  },
  steps: [
    {
      name: "Composer dropdowns open above the control row",
      run: async (ctx) => {
        await ensureComposer(ctx);

        await openMenu(ctx, "composer-add-menu-button", "composer-tool-menu");
        await ctx.screenshot("composer-tool-menu", {
          claim: "The plus control opens a visible tool menu above the composer row.",
          voiceover: "The add menu is no longer clipped by the composer toolbar.",
          hashIncludes: "/session/",
        });
        await closeMenu(ctx, "composer-add-menu-button", "composer-tool-menu");

        await openMenu(ctx, "composer-run-mode-button", "composer-run-mode-menu");
        await ctx.screenshot("composer-run-mode-menu", {
          claim: "The run mode selector opens a visible menu above its button.",
          voiceover: "The run mode menu appears above the control row instead of being hidden.",
          hashIncludes: "/session/",
        });
        await closeMenu(ctx, "composer-run-mode-button", "composer-run-mode-menu");

        await openMenu(ctx, "composer-approval-mode-button", "composer-approval-mode-menu");
        await ctx.screenshot("composer-approval-mode-menu", {
          claim: "The approval selector opens a visible menu above its button.",
          voiceover: "The approval menu is visible and clickable.",
          hashIncludes: "/session/",
        });
        await closeMenu(ctx, "composer-approval-mode-button", "composer-approval-mode-menu");

        await openMenu(ctx, "composer-agent-button", "composer-agent-menu");
        await ctx.screenshot("composer-agent-menu", {
          claim: "The agent selector opens a visible menu above its button.",
          voiceover: "The default agent menu is visible rather than clipped inside the toolbar.",
          hashIncludes: "/session/",
        });
        await closeMenu(ctx, "composer-agent-button", "composer-agent-menu");

        const hasContextIndicator = await ctx.eval(`Boolean(document.querySelector('[data-testid="composer-context-window-indicator"]'))`);
        if (hasContextIndicator) {
          await openContextTooltip(ctx);
          await ctx.screenshot("composer-context-window-tooltip", {
            claim: "The context window indicator shows a visible tooltip on hover.",
            voiceover: "The context usage indicator can show its hover details without clipping.",
            hashIncludes: "/session/",
          });
        } else {
          ctx.log("Context window indicator not rendered for the currently selected model; tooltip check skipped.");
        }
      },
    },
  ],
};

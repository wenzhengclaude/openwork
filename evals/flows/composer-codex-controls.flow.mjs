async function setLanguage(ctx, lang) {
  await ctx.eval(`(() => {
    window.localStorage.setItem("openwork.language", ${JSON.stringify(lang)});
    window.location.reload();
    return true;
  })()`);
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: `control API after switching language to ${lang}`,
  });
}

async function restoreLanguage(ctx, originalLanguage) {
  await ctx.eval(`(() => {
    if (${JSON.stringify(originalLanguage)} === null) {
      window.localStorage.removeItem("openwork.language");
    } else {
      window.localStorage.setItem("openwork.language", ${JSON.stringify(originalLanguage)});
    }
    window.location.reload();
    return true;
  })()`);
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after restoring language",
  });
}

async function ensureComposer(ctx) {
  await ctx.navigateHash("/session");
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after returning to session route",
  });

  const hasComposer = await ctx.waitFor(
    `(() => {
      if (document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')) return "ready";
      const action = window.__openworkControl.listActions().find((a) => a.id === "session.create_task");
      if (action && !action.disabled) return "create";
      return null;
    })()`,
    { timeoutMs: 60_000, label: "composer ready or session.create_task enabled" },
  );

  if (hasComposer === "create") {
    await ctx.control("session.create_task");
  }

  await ctx.waitFor(`Boolean(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'))`, {
    timeoutMs: 60_000,
    label: "composer editor",
  });
}

export default {
  id: "composer-codex-controls",
  title: "Composer uses Codex-style add and send controls",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const state = await ctx.eval(
      `(() => {
        const control = window.__openworkControl;
        const route = control.snapshot().route;
        if (route.startsWith("/welcome") || route.startsWith("/signin")) return "blocked";
        return "ready";
      })()`
    );
    return state === "blocked"
      ? "Profile is not onboarded; composer controls require a workspace."
      : null;
  },
  steps: [
    {
      name: "Idle composer has a plus add menu and circular send button",
      run: async (ctx) => {
        const originalLanguage = await ctx.eval("window.localStorage.getItem('openwork.language')");

        try {
          await setLanguage(ctx, "zh");
          await ensureComposer(ctx);
          await ctx.expectText("描述你的任务", { timeoutMs: 30_000 });

          const idleState = await ctx.eval(`(() => {
            const add = document.querySelector('[data-testid="composer-add-menu-button"]');
            const send = document.querySelector('[data-testid="composer-send-button"]');
            const addRect = add?.getBoundingClientRect();
            const sendRect = send?.getBoundingClientRect();
            const sendStyle = send ? getComputedStyle(send) : null;
            const visibleAttachButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
              if (button === add) return false;
              const title = button.getAttribute('title') || '';
              if (!title.includes('附加文件') && !title.includes('Attach files')) return false;
              const rect = button.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }).length;
            return {
              hasAdd: Boolean(add),
              hasSend: Boolean(send),
              addText: add?.textContent?.trim() || '',
              sendWidth: sendRect?.width || 0,
              sendHeight: sendRect?.height || 0,
              sendRadius: sendStyle ? parseFloat(sendStyle.borderRadius) : 0,
              sendHasSrOnlyLabel: Boolean(send?.querySelector('.sr-only')),
              visibleAttachButtons,
            };
          })()`);
          ctx.assert(idleState.hasAdd, "Composer add menu button was not rendered.");
          ctx.assert(idleState.hasSend, "Composer send button was not rendered.");
          ctx.assert(idleState.addText === "", `Add button should be icon-only, got text: ${idleState.addText}`);
          ctx.assert(Math.abs(idleState.sendWidth - idleState.sendHeight) <= 2, `Send button is not square: ${idleState.sendWidth}x${idleState.sendHeight}.`);
          ctx.assert(idleState.sendRadius >= idleState.sendWidth / 2 - 2, `Send button is not circular; radius ${idleState.sendRadius}, width ${idleState.sendWidth}.`);
          ctx.assert(idleState.sendHasSrOnlyLabel, "Send button lost its accessible Run task label.");
          ctx.assert(idleState.visibleAttachButtons === 0, "Standalone paperclip attachment button is still visible.");

          await ctx.screenshot("composer-codex-idle-controls", {
            claim: "The idle composer presents Codex-style icon controls: a plus add menu and a circular arrow send button.",
            voiceover: "The composer now uses a single plus button for add actions and an icon-only circular send button.",
            requireText: ["描述你的任务"],
            hashIncludes: "/session/",
          });

          await ctx.eval(`document.querySelector('[data-testid="composer-add-menu-button"]')?.click()`);
          await ctx.expectText("附加文件", { timeoutMs: 10_000 });
          await ctx.expectText("MCP", { timeoutMs: 10_000 });
          await ctx.screenshot("composer-codex-add-menu", {
            claim: "The plus menu preserves attachment and tool access in one place.",
            voiceover: "Opening the plus menu exposes Attach files first, followed by the existing agent, command, skill, extension, and MCP controls.",
            requireText: ["附加文件", "MCP"],
            hashIncludes: "/session/",
          });
        } finally {
          await restoreLanguage(ctx, originalLanguage);
        }
      },
    },
  ],
};

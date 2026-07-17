const LOCALIZED_EXPECTATIONS = [
  { lang: "en", title: "Customization", workspace: "Workspace" },
  { lang: "ja", title: "カスタマイズ", workspace: "ワークスペース" },
  { lang: "zh", title: "自定义", workspace: "工作区" },
  { lang: "vi", title: "Tùy chỉnh", workspace: "Workspace" },
  { lang: "pt-BR", title: "Personalização", workspace: "Workspace" },
  { lang: "th", title: "การปรับแต่ง", workspace: "พื้นที่ทำงาน" },
  { lang: "fr", title: "Personnalisation", workspace: "Espace" },
  { lang: "ca", title: "Personalització", workspace: "Workspace" },
  { lang: "es", title: "Personalización", workspace: "Espacio" },
  { lang: "ru", title: "Настройка", workspace: "Рабочая область" },
];

async function setLanguage(ctx, lang) {
  await ctx.eval(`(() => {
    window.localStorage.setItem("openwork.language", ${JSON.stringify(lang)});
    window.location.reload();
    return true;
  })()`);
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 30_000,
    label: `control API after switching language to ${lang}`,
  });
  await ctx.navigateHash("/settings/shell");
  await ctx.waitFor("window.location.hash.includes('/settings/shell')", {
    timeoutMs: 30_000,
    label: `customization route in ${lang}`,
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
    timeoutMs: 30_000,
    label: "control API after restoring language",
  });
}

export default {
  id: "shell-customization-localized",
  title: "Customization settings are localized across supported languages",
  kind: "user-facing",
  steps: [
    {
      name: "Customization settings render translated Open One controls",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 30_000,
          label: "control API before navigating to customization settings",
        });
        const originalLanguage = await ctx.eval("window.localStorage.getItem('openwork.language')");
        const expectedShortcut = await ctx.eval("navigator.platform.includes('Mac') ? 'Cmd+K' : 'Ctrl+K'");

        try {
          for (const expected of LOCALIZED_EXPECTATIONS) {
            await setLanguage(ctx, expected.lang);
            await ctx.expectText(expected.title);
            await ctx.expectNoText("OpenWork Cloud");
            await ctx.expectNoText("settings.shell.");
            await ctx.waitFor(
              `Array.from(document.querySelectorAll("svg text")).some((node) => (node.textContent || "").includes(${JSON.stringify(expected.workspace)}))`,
              { timeoutMs: 10_000, label: `wireframe workspace label in ${expected.lang}` },
            );
            ctx.recordEvidence({
              type: "assertion",
              status: "passed",
              assertion: `Wireframe preview label is localized for ${expected.lang}: ${expected.workspace}`,
            });
            if (expected.lang === "zh") {
              await ctx.expectText(`隐藏的入口仍可通过命令面板（${expectedShortcut}）打开。`);
            }
            await ctx.screenshot(`customization-settings-${expected.lang}`, {
              claim: `The customization settings page renders translated Open One copy for ${expected.lang}.`,
              voiceover: `The customization page is switched to ${expected.lang}, showing translated labels and no OpenWork Cloud copy.`,
              requireText: [expected.title],
              rejectText: ["OpenWork Cloud", "settings.shell."],
              hashIncludes: "/settings/shell",
            });
          }
        } finally {
          await restoreLanguage(ctx, originalLanguage);
        }
      },
    },
  ],
};

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
  await ctx.navigateHash("/settings/advanced");
  await ctx.waitFor("window.location.hash.includes('/settings/advanced')", {
    timeoutMs: 30_000,
    label: `advanced settings route in ${lang}`,
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
  id: "advanced-settings-localized",
  title: "Advanced settings shell and server controls are localized",
  kind: "user-facing",
  steps: [
    {
      name: "Advanced settings render Chinese copy for the visible shell and server controls",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 30_000,
          label: "control API before navigating to advanced settings",
        });
        const originalLanguage = await ctx.eval("window.localStorage.getItem('openwork.language')");

        try {
          await setLanguage(ctx, "zh");
          await ctx.expectText("返回应用");
          await ctx.expectText("设置");
          await ctx.expectText("偏好设置");
          await ctx.expectText("权限");
          await ctx.expectText("AI 提供商");
          await ctx.expectText("高级");
          await ctx.expectText("组织服务器");
          await ctx.expectText("服务器端点");
          await ctx.expectText("清除服务器配置");
          await ctx.expectNoText("Back to app");
          await ctx.expectNoText("Organization server");
          await ctx.expectNoText("Point OpenWork at the server your organization hosts.");
          await ctx.expectNoText("Server endpoints");
          await ctx.expectNoText("Read-only view of the URLs OpenWork will use");
          await ctx.expectNoText("Clear server configuration");
          await ctx.expectNoText("AI Providers");
          await ctx.expectNoText("Preferences");
          await ctx.expectNoText("Authorized folders and file access");
          await ctx.expectNoText("settings.runtime_config_");

          await ctx.screenshot("advanced-settings-zh-localized", {
            claim: "The advanced settings page renders Chinese shell, navigation, organization server, and endpoint copy.",
            voiceover: "The Advanced settings page is switched to Chinese, and the visible server controls no longer show the English copy from the screenshot.",
            requireText: ["返回应用", "组织服务器", "服务器端点", "清除服务器配置"],
            rejectText: [
              "Back to app",
              "Organization server",
              "Server endpoints",
              "Clear server configuration",
              "AI Providers",
              "Preferences",
            ],
            hashIncludes: "/settings/advanced",
          });
        } finally {
          await restoreLanguage(ctx, originalLanguage);
        }
      },
    },
  ],
};

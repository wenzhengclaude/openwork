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
  await ctx.navigateHash("/settings/preferences");
  await ctx.waitFor("window.location.hash.includes('/settings/preferences')", {
    timeoutMs: 30_000,
    label: `preferences settings route in ${lang}`,
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
  id: "preferences-settings-localized",
  title: "Preferences settings notification, privacy, and memory controls are localized",
  kind: "user-facing",
  steps: [
    {
      name: "Preferences settings render Chinese notification, privacy, and memory copy",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 30_000,
          label: "control API before navigating to preferences settings",
        });
        const originalLanguage = await ctx.eval("window.localStorage.getItem('openwork.language')");

        try {
          await setLanguage(ctx, "zh");
          await ctx.expectText("桌面通知");
          await ctx.expectText("通知我");
          await ctx.expectText("关闭");
          await ctx.expectText("隐私");
          await ctx.expectText("分享匿名使用数据");
          await ctx.expectText("记忆库");
          await ctx.expectText("记忆库（预览）");
          await ctx.expectNoText("Desktop Notifications");
          await ctx.expectNoText("Native notifications from the desktop app");
          await ctx.expectNoText("Notify me");
          await ctx.expectNoText("Choose which OpenWork events can appear");
          await ctx.expectNoText("Privacy");
          await ctx.expectNoText("Share anonymous usage data");
          await ctx.expectNoText("Helps us understand which features matter");
          await ctx.expectNoText("Memory Bank");
          await ctx.expectNoText("Show the memory management panel");

          await ctx.screenshot("preferences-settings-zh-localized", {
            claim: "The preferences settings page renders Chinese notification, privacy, and memory copy.",
            voiceover: "The Preferences settings page is switched to Chinese and no longer shows English notification, privacy, or Memory Bank labels.",
            requireText: ["桌面通知", "隐私", "分享匿名使用数据", "记忆库"],
            rejectText: [
              "Desktop Notifications",
              "Native notifications from the desktop app",
              "Privacy",
              "Share anonymous usage data",
              "Memory Bank",
            ],
            hashIncludes: "/settings/preferences",
          });
        } finally {
          await restoreLanguage(ctx, originalLanguage);
        }
      },
    },
  ],
};

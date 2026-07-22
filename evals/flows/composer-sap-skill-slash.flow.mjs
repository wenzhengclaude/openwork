export default {
  id: "composer-sap-skill-slash",
  title: "Slash search includes installed SAP skills",
  kind: "user-facing",
  steps: [
    {
      name: "Typing /sap surfaces the installed SAP skill catalog",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 60_000,
          label: "control API",
        });

        const state = await ctx.waitFor(
          `(() => {
            const actions = window.__openworkControl.listActions();
            if (actions.some((action) => action.id === 'composer.set_text' && !action.disabled)) return "composer";
            if (actions.some((action) => action.id === 'session.create_task' && !action.disabled)) return "create";
            return null;
          })()`,
          { timeoutMs: 60_000, label: "composer or enabled create action" },
        );

        if (state === "create") {
          await ctx.control("session.create_task");
          await ctx.waitFor(
            "window.__openworkControl.listActions().some((action) => action.id === 'composer.set_text' && !action.disabled)",
            { timeoutMs: 60_000, label: "composer action" },
          );
        }

        await ctx.control("composer.set_text", { text: "/sap" });
        const rows = await ctx.waitFor(
          `(() => {
            const rows = Array.from(document.querySelectorAll('button'))
              .map((button) => button.innerText.replace(/\\s+/g, ' ').trim())
              .filter((text) => text.startsWith('/sap'));
            return rows.length >= 20 ? rows : null;
          })()`,
          { timeoutMs: 60_000, label: "SAP slash skill rows" },
        );

        ctx.assert(rows.some((text) => text.includes("/sap-login")), "/sap-login was not shown in slash search.");
        ctx.assert(rows.some((text) => text.includes("/sap-review-abap")), "/sap-review-abap was not shown in slash search.");
        ctx.assert(rows.some((text) => text.includes("/sap-cmod")), "/sap-cmod was not shown in slash search.");
        ctx.output("SAP slash rows", `Matched ${rows.length} SAP skill rows. Sample: ${rows.slice(0, 8).join(" | ")}`);

        await ctx.control("composer.set_text", { text: "" });
        await ctx.waitFor(
          "document.querySelector('[contenteditable=\"true\"]')?.innerText.trim() === ''",
          { timeoutMs: 30_000, label: "composer cleared after slash proof" },
        );
        await ctx.eval("location.reload()");
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 60_000,
          label: "control API after slash proof reload",
        });

        await ctx.screenshot("sap-slash-skills-proven", {
          claim: "The app stayed interactive after proving that /sap slash search contains the installed SAP skills.",
        });
      },
    },
  ],
};

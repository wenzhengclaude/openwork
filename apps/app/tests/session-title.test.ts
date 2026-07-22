import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SESSION_TITLE,
  deriveInitialSessionTitle,
  shouldApplyInitialSessionTitle,
} from "../src/app/lib/session-title";

describe("session titles", () => {
  test("uses the user's first line as the initial generated title", () => {
    expect(deriveInitialSessionTitle("  这是什么  ")).toBe("这是什么");
    expect(deriveInitialSessionTitle("\n\nPlease inspect this screenshot\nwith details")).toBe("Please inspect this screenshot");
  });

  test("keeps generated initial titles compact", () => {
    expect(deriveInitialSessionTitle("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")).toBe("abcdefghijklmnopqrstuvwxyz0123456789ABCD...");
  });

  test("only applies initial titles to unnamed default sessions", () => {
    expect(shouldApplyInitialSessionTitle(null)).toBe(true);
    expect(shouldApplyInitialSessionTitle("")).toBe(true);
    expect(shouldApplyInitialSessionTitle(DEFAULT_SESSION_TITLE)).toBe(true);
    expect(shouldApplyInitialSessionTitle("New session - 2026-07-17T12:00:00.000Z")).toBe(true);
    expect(shouldApplyInitialSessionTitle("页面显示异常识别")).toBe(false);
  });
});

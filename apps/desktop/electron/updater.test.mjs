import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { electronUpdaterFeedUrl, staleUpdaterStatePaths } from "./updater.mjs";

const fakeApp = { getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`) };

describe("staleUpdaterStatePaths", () => {
  it("targets the ShipIt cache on macOS", { skip: process.platform !== "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), [
      "/Users/test/Library/Caches/com.differentai.openwork.ShipIt",
    ]);
  });

  it("is a no-op off macOS", { skip: process.platform === "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), []);
  });
});

describe("electronUpdaterFeedUrl", () => {
  it("uses the internal Open One update feed for stable Windows releases", () => {
    assert.equal(electronUpdaterFeedUrl("stable"), "http://10.10.16.164:13006");
  });
});

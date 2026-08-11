import { describe, it, expect } from "vitest";
import {
  withWorkerNamespace,
  currentWorkerSuffix,
  namespaceWorkerName,
} from "../deploy-context";

describe("worker-name namespace", () => {
  it("leaves names unchanged outside any namespace (the local tool)", () => {
    expect(currentWorkerSuffix()).toBeNull();
    expect(namespaceWorkerName("zotero-assistant")).toBe("zotero-assistant");
  });

  it("suffixes names inside a namespace (a hosted user)", () => {
    const name = withWorkerNamespace("alice", () =>
      namespaceWorkerName("zotero-assistant")
    );
    expect(name).toBe("zotero-assistant-alice");
  });

  it("isolates the namespace to its callback", () => {
    withWorkerNamespace("alice", () => {
      expect(currentWorkerSuffix()).toBe("alice");
    });
    expect(currentWorkerSuffix()).toBeNull();
  });

  it("keeps concurrent requests from bleeding into each other", async () => {
    // Two overlapping async contexts must each see only their own suffix.
    const results = await Promise.all([
      withWorkerNamespace("alice", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return namespaceWorkerName("zotero");
      }),
      withWorkerNamespace("bob", async () => {
        return namespaceWorkerName("zotero");
      }),
    ]);
    expect(results).toEqual(["zotero-alice", "zotero-bob"]);
  });
});

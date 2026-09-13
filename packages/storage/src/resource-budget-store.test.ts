import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ResourceBudgetConfigurationError, ResourceBudgetExceededError, ResourceBudgetStore } from "./resource-budget-store.ts";

describe("ResourceBudgetStore", () => {
  it("atomically reserves maximum cost before concurrent work can exceed the daily limit", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "aituber-budget-")), "usage.db");
    const first = new ResourceBudgetStore(path, { runtime: 1 }); const second = new ResourceBudgetStore(path, { runtime: 1 });
    const results = await Promise.allSettled([first, second].map(async (store) => {
      await Promise.resolve();
      return store.reserve({ scope: "runtime", resource: "llm", maximumUnits: 1_000, maximumCostUsd: 0.6, requestedAt: "2026-09-14T01:00:00.000Z" });
    }));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({ reason: expect.any(ResourceBudgetExceededError) });
    expect(first.list("2026-09-14")).toHaveLength(1);
    first.close(); second.close();
  });

  it("requires prices and a limit for paid work, while allowing an explicitly free provider", () => {
    const store = new ResourceBudgetStore(":memory:", {});
    expect(() => store.reserve({ scope: "authoring", resource: "llm", maximumUnits: 10, maximumCostUsd: null })).toThrow(ResourceBudgetConfigurationError);
    expect(() => store.reserve({ scope: "authoring", resource: "llm", maximumUnits: 10, maximumCostUsd: 0.01 })).toThrow(ResourceBudgetConfigurationError);
    const free = store.reserve({ scope: "runtime", resource: "tts", maximumUnits: 20, maximumCostUsd: 0 }); free.commit(); free.commit();
    expect(store.list()).toMatchObject([{ scope: "runtime", resource: "tts", reservedCostUsd: 0, status: "committed" }]);
    store.close();
  });

  it("keeps authoring and runtime usage in separate ledgers", () => {
    const store = new ResourceBudgetStore(":memory:", { authoring: 1, runtime: 1 });
    store.reserve({ scope: "authoring", resource: "llm", maximumUnits: 100, maximumCostUsd: 0.8, requestedAt: "2026-09-14T00:00:00Z" }).commit();
    store.reserve({ scope: "runtime", resource: "llm", maximumUnits: 100, maximumCostUsd: 0.8, requestedAt: "2026-09-14T00:00:00Z" }).commit();
    expect(store.list()).toHaveLength(2); store.close();
  });

  it("enforces reserved token or character units even for zero-cost providers", () => {
    const store = new ResourceBudgetStore(":memory:", {}, { "runtime:llm": 100, "runtime:tts": 3 });
    store.reserve({ scope: "runtime", resource: "llm", maximumUnits: 80, maximumCostUsd: 0 }).commit();
    expect(() => store.reserve({ scope: "runtime", resource: "llm", maximumUnits: 21, maximumCostUsd: 0 })).toThrow(ResourceBudgetExceededError);
    store.reserve({ scope: "runtime", resource: "tts", maximumUnits: 3, maximumCostUsd: 0 }).commit();
    expect(() => store.reserve({ scope: "runtime", resource: "tts", maximumUnits: 1, maximumCostUsd: 0 })).toThrow(ResourceBudgetExceededError);
    store.close();
  });
});

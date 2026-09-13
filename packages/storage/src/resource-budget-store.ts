import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type UsageScope = "authoring" | "runtime";
export type UsageResource = "llm" | "tts";
export type ResourceUnitLimitKey = `${UsageScope}:${UsageResource}`;
export const DEFAULT_DAILY_UNIT_LIMITS: Readonly<Record<ResourceUnitLimitKey, number>> = { "authoring:llm": 100_000_000, "authoring:tts": 0, "runtime:llm": 10_000_000, "runtime:tts": 1_000_000 };
export interface StoredUsageReservation { readonly id: string; readonly budgetDay: string; readonly scope: UsageScope; readonly resource: UsageResource; readonly maximumUnits: number; readonly reservedCostUsd: number; readonly status: "reserved" | "committed"; readonly requestedAt: string; readonly committedAt: string | null }
interface ReservationRow { id: string; budget_day: string; scope: UsageScope; resource: UsageResource; maximum_units: number; reserved_cost_usd: number; status: StoredUsageReservation["status"]; requested_at: string; committed_at: string | null }

export class ResourceBudgetConfigurationError extends Error { constructor(message: string) { super(message); this.name = "ResourceBudgetConfigurationError"; } }
export class ResourceBudgetExceededError extends Error { constructor(message: string) { super(message); this.name = "ResourceBudgetExceededError"; } }

export class ResourceBudgetStore {
  readonly #database: Database.Database; readonly #dailyLimits: Readonly<Partial<Record<UsageScope, number>>>; readonly #dailyUnitLimits: Readonly<Record<ResourceUnitLimitKey, number>>;
  constructor(databasePath: string, dailyLimits: Readonly<Partial<Record<UsageScope, number>>>, dailyUnitLimits: Readonly<Partial<Record<ResourceUnitLimitKey, number>>> = {}) {
    this.#database = new Database(databasePath); this.#database.pragma("journal_mode = WAL"); this.#database.pragma("synchronous = FULL");
    for (const [scope, limit] of Object.entries(dailyLimits)) if (!Number.isFinite(limit) || limit! < 0) throw new TypeError(`${scope} daily budget must be non-negative`);
    for (const [resource, limit] of Object.entries(dailyUnitLimits)) if (!Number.isSafeInteger(limit) || limit! < 0) throw new TypeError(`${resource} daily unit limit must be a non-negative integer`);
    this.#dailyLimits = { ...dailyLimits }; this.#dailyUnitLimits = { ...DEFAULT_DAILY_UNIT_LIMITS, ...dailyUnitLimits }; this.#migrate();
  }
  close() { this.#database.close(); }
  reserve(input: { readonly scope: UsageScope; readonly resource: UsageResource; readonly maximumUnits: number; readonly maximumCostUsd: number | null; readonly requestedAt?: string }) {
    if (!Number.isSafeInteger(input.maximumUnits) || input.maximumUnits < 0) throw new TypeError("maximumUnits must be a non-negative integer");
    if (input.maximumCostUsd === null) throw new ResourceBudgetConfigurationError("利用単価が未設定のため外部API呼び出しを開始できません。");
    if (!Number.isFinite(input.maximumCostUsd) || input.maximumCostUsd < 0) throw new TypeError("maximumCostUsd must be non-negative");
    const requestedAt = input.requestedAt ?? new Date().toISOString(); const instant = Date.parse(requestedAt); if (Number.isNaN(instant)) throw new TypeError("requestedAt must be an ISO timestamp");
    const budgetDay = new Date(instant).toISOString().slice(0, 10); const id = `reservation.${randomUUID()}`;
    this.#database.transaction(() => {
      const limit = this.#dailyLimits[input.scope];
      if (input.maximumCostUsd! > 0 && limit === undefined) throw new ResourceBudgetConfigurationError(`${input.scope}の1日費用上限が未設定のため外部API呼び出しを開始できません。`);
      const row = this.#database.prepare("SELECT COALESCE(SUM(reserved_cost_usd), 0) AS total FROM usage_reservations WHERE budget_day = ? AND scope = ?").get(budgetDay, input.scope) as { total: number };
      if (limit !== undefined && row.total + input.maximumCostUsd! > limit + 1e-12) throw new ResourceBudgetExceededError(`${input.scope}の1日費用上限に達したため新しい外部API呼び出しを開始しません。`);
      const unitLimit = this.#dailyUnitLimits[`${input.scope}:${input.resource}`];
      const units = this.#database.prepare("SELECT COALESCE(SUM(maximum_units), 0) AS total FROM usage_reservations WHERE budget_day = ? AND scope = ? AND resource = ?").get(budgetDay, input.scope, input.resource) as { total: number };
      if (units.total + input.maximumUnits > unitLimit) throw new ResourceBudgetExceededError(`${input.scope}の1日${input.resource}利用量上限に達したため新しい外部API呼び出しを開始しません。`);
      this.#database.prepare("INSERT INTO usage_reservations (id, budget_day, scope, resource, maximum_units, reserved_cost_usd, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?)").run(id, budgetDay, input.scope, input.resource, input.maximumUnits, input.maximumCostUsd, requestedAt);
    }).immediate();
    let committed = false;
    return { id, commit: () => { if (committed) return; committed = true; this.#database.prepare("UPDATE usage_reservations SET status = 'committed', committed_at = ? WHERE id = ? AND status = 'reserved'").run(new Date().toISOString(), id); } };
  }
  list(budgetDay?: string): readonly StoredUsageReservation[] {
    const rows = (budgetDay ? this.#database.prepare("SELECT * FROM usage_reservations WHERE budget_day = ? ORDER BY requested_at, id").all(budgetDay) : this.#database.prepare("SELECT * FROM usage_reservations ORDER BY requested_at, id").all()) as ReservationRow[];
    return rows.map((row) => ({ id: row.id, budgetDay: row.budget_day, scope: row.scope, resource: row.resource, maximumUnits: row.maximum_units, reservedCostUsd: row.reserved_cost_usd, status: row.status, requestedAt: row.requested_at, committedAt: row.committed_at }));
  }
  #migrate() { this.#database.exec(`CREATE TABLE IF NOT EXISTS usage_reservations (
    id TEXT PRIMARY KEY, budget_day TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('authoring','runtime')), resource TEXT NOT NULL CHECK(resource IN ('llm','tts')),
    maximum_units INTEGER NOT NULL CHECK(maximum_units >= 0), reserved_cost_usd REAL NOT NULL CHECK(reserved_cost_usd >= 0), status TEXT NOT NULL CHECK(status IN ('reserved','committed')),
    requested_at TEXT NOT NULL, committed_at TEXT
  ); CREATE INDEX IF NOT EXISTS usage_reservations_day_scope ON usage_reservations(budget_day, scope);`); }
}

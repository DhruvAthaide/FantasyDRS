/**
 * Drizzle schema — ported 1:1 from backend/app/models.py.
 *
 * Conventions:
 *   - Table names kept snake_case to match existing Python + JSON contracts.
 *   - Python `Float` → pg `real` (single-precision) since the source used SQLite
 *     REAL semantics. Switch to `doublePrecision` later if precision becomes an
 *     issue for simulation stats.
 *   - Foreign keys mirror SQLAlchemy ForeignKey() declarations.
 *   - `races.round` gets a unique index so the seed script can upsert by round.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// constructors
// ---------------------------------------------------------------------------
export const constructors = pgTable("constructors", {
  id: serial("id").primaryKey(),
  refId: text("ref_id").notNull().unique(),
  name: text("name").notNull(),
  color: text("color"),
});

// ---------------------------------------------------------------------------
// drivers
// ---------------------------------------------------------------------------
export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 3 }).notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  number: integer("number"),
  constructorId: integer("constructor_id").references(() => constructors.id),
  country: text("country"),
});

// ---------------------------------------------------------------------------
// circuits
// ---------------------------------------------------------------------------
export const circuits = pgTable("circuits", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country"),
  overtakeDifficulty: real("overtake_difficulty").default(0.5),
  highSpeed: real("high_speed").default(0.5),
  streetCircuit: boolean("street_circuit").default(false),
  altitude: integer("altitude").default(0),
  avgDegradation: real("avg_degradation").default(0.5),
});

// ---------------------------------------------------------------------------
// races
// ---------------------------------------------------------------------------
export const races = pgTable(
  "races",
  {
    id: serial("id").primaryKey(),
    round: integer("round").notNull(),
    name: text("name").notNull(),
    circuitId: integer("circuit_id").references(() => circuits.id),
    date: text("date"),
    hasSprint: boolean("has_sprint").default(false),
    laps: integer("laps").default(57),
    drsZones: integer("drs_zones").default(3),
  },
  (table) => ({
    roundIdx: uniqueIndex("races_round_unique").on(table.round),
  })
);

// ---------------------------------------------------------------------------
// fantasy_prices
// ---------------------------------------------------------------------------
export const fantasyPrices = pgTable("fantasy_prices", {
  id: serial("id").primaryKey(),
  assetType: text("asset_type").notNull(),
  assetId: integer("asset_id").notNull(),
  raceId: integer("race_id").references(() => races.id),
  price: real("price").notNull(),
  priceChange: real("price_change").default(0),
  recordedAt: timestamp("recorded_at", { withTimezone: false }).defaultNow(),
});

// ---------------------------------------------------------------------------
// fantasy_scores
// ---------------------------------------------------------------------------
export const fantasyScores = pgTable("fantasy_scores", {
  id: serial("id").primaryKey(),
  assetType: text("asset_type").notNull(),
  assetId: integer("asset_id").notNull(),
  raceId: integer("race_id").references(() => races.id),
  sessionType: text("session_type"),
  qualifyingPts: real("qualifying_pts").default(0),
  racePositionPts: real("race_position_pts").default(0),
  positionsGainedPts: real("positions_gained_pts").default(0),
  overtakePts: real("overtake_pts").default(0),
  fastestLapPts: real("fastest_lap_pts").default(0),
  dotdPts: real("dotd_pts").default(0),
  dnfPenalty: real("dnf_penalty").default(0),
  pitstopPts: real("pitstop_pts").default(0),
  totalPts: real("total_pts").default(0),
});

// ---------------------------------------------------------------------------
// pitstop_results
// ---------------------------------------------------------------------------
export const pitstopResults = pgTable("pitstop_results", {
  id: serial("id").primaryKey(),
  constructorId: integer("constructor_id").references(() => constructors.id),
  raceId: integer("race_id").references(() => races.id),
  stopNumber: integer("stop_number").default(1),
  timeSeconds: real("time_seconds").notNull(),
  pointsScored: real("points_scored").default(0),
  isFastest: boolean("is_fastest").default(false),
});

// ---------------------------------------------------------------------------
// power_unit_allocations
// ---------------------------------------------------------------------------
export const powerUnitAllocations = pgTable("power_unit_allocations", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").references(() => drivers.id),
  componentType: text("component_type").notNull(),
  raceId: integer("race_id").references(() => races.id),
  isNew: boolean("is_new").default(true),
  totalUsed: integer("total_used").default(1),
});

// ---------------------------------------------------------------------------
// race_results
// ---------------------------------------------------------------------------
export const raceResults = pgTable(
  "race_results",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id").references(() => races.id),
    driverId: integer("driver_id").references(() => drivers.id),
    qualifyingPosition: integer("qualifying_position"),
    racePosition: integer("race_position"),
    dnf: boolean("dnf").default(false),
    fastestLap: boolean("fastest_lap").default(false),
    dotd: boolean("dotd").default(false),
    overtakes: integer("overtakes").default(0),
  },
  (table) => ({
    // Composite unique — enables idempotent upserts from the F1 data importer
    // (one result per driver per race).
    raceDriverUnique: uniqueIndex("race_results_race_driver_unique").on(
      table.raceId,
      table.driverId
    ),
  })
);

// ---------------------------------------------------------------------------
// simulation_results
// ---------------------------------------------------------------------------
export const simulationResults = pgTable("simulation_results", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id").references(() => races.id),
  assetType: text("asset_type").notNull(),
  assetId: integer("asset_id").notNull(),
  expectedPtsMean: real("expected_pts_mean"),
  expectedPtsMedian: real("expected_pts_median"),
  expectedPtsStd: real("expected_pts_std"),
  expectedPtsP10: real("expected_pts_p10"),
  expectedPtsP90: real("expected_pts_p90"),
  qpaceMean: real("qpace_mean"),
  qpaceStd: real("qpace_std"),
  rpaceMean: real("rpace_mean"),
  rpaceStd: real("rpace_std"),
  dnfProbability: real("dnf_probability"),
  flProbability: real("fl_probability"),
  simulatedAt: timestamp("simulated_at", { withTimezone: false }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const constructorsRelations = relations(constructors, ({ many }) => ({
  drivers: many(drivers),
  pitstopResults: many(pitstopResults),
}));

export const driversRelations = relations(drivers, ({ one, many }) => ({
  constructor: one(constructors, {
    fields: [drivers.constructorId],
    references: [constructors.id],
  }),
  raceResults: many(raceResults),
  powerUnitAllocations: many(powerUnitAllocations),
}));

export const circuitsRelations = relations(circuits, ({ many }) => ({
  races: many(races),
}));

export const racesRelations = relations(races, ({ one, many }) => ({
  circuit: one(circuits, {
    fields: [races.circuitId],
    references: [circuits.id],
  }),
  pitstopResults: many(pitstopResults),
  powerUnitAllocations: many(powerUnitAllocations),
  raceResults: many(raceResults),
}));

export const pitstopResultsRelations = relations(pitstopResults, ({ one }) => ({
  constructor: one(constructors, {
    fields: [pitstopResults.constructorId],
    references: [constructors.id],
  }),
  race: one(races, {
    fields: [pitstopResults.raceId],
    references: [races.id],
  }),
}));

export const powerUnitAllocationsRelations = relations(
  powerUnitAllocations,
  ({ one }) => ({
    driver: one(drivers, {
      fields: [powerUnitAllocations.driverId],
      references: [drivers.id],
    }),
    race: one(races, {
      fields: [powerUnitAllocations.raceId],
      references: [races.id],
    }),
  })
);

export const raceResultsRelations = relations(raceResults, ({ one }) => ({
  race: one(races, {
    fields: [raceResults.raceId],
    references: [races.id],
  }),
  driver: one(drivers, {
    fields: [raceResults.driverId],
    references: [drivers.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types (one pair per table)
// ---------------------------------------------------------------------------
export type Constructor = typeof constructors.$inferSelect;
export type NewConstructor = typeof constructors.$inferInsert;

export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;

export type Circuit = typeof circuits.$inferSelect;
export type NewCircuit = typeof circuits.$inferInsert;

export type Race = typeof races.$inferSelect;
export type NewRace = typeof races.$inferInsert;

export type FantasyPrice = typeof fantasyPrices.$inferSelect;
export type NewFantasyPrice = typeof fantasyPrices.$inferInsert;

export type FantasyScore = typeof fantasyScores.$inferSelect;
export type NewFantasyScore = typeof fantasyScores.$inferInsert;

export type PitstopResult = typeof pitstopResults.$inferSelect;
export type NewPitstopResult = typeof pitstopResults.$inferInsert;

export type PowerUnitAllocation = typeof powerUnitAllocations.$inferSelect;
export type NewPowerUnitAllocation = typeof powerUnitAllocations.$inferInsert;

export type RaceResult = typeof raceResults.$inferSelect;
export type NewRaceResult = typeof raceResults.$inferInsert;

export type SimulationResult = typeof simulationResults.$inferSelect;
export type NewSimulationResult = typeof simulationResults.$inferInsert;

// ---------------------------------------------------------------------------
// Mini-league (Plan 07-02) — shared admin-managed tracker
// ---------------------------------------------------------------------------

export const leagueMembers = pgTable("league_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: false }).defaultNow(),
});

export const memberRaceTeams = pgTable(
  "member_race_teams",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => leagueMembers.id),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    driverIds: integer("driver_ids").array().notNull(),
    constructorIds: integer("constructor_ids").array().notNull(),
    drsDriverId: integer("drs_driver_id"),
    updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow(),
  },
  (table) => ({
    memberRaceUnique: uniqueIndex("member_race_teams_member_race_unique").on(
      table.memberId,
      table.raceId
    ),
  })
);

export const memberRaceScores = pgTable(
  "member_race_scores",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => leagueMembers.id),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    points: real("points").notNull().default(0),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow(),
  },
  (table) => ({
    memberRaceUnique: uniqueIndex("member_race_scores_member_race_unique").on(
      table.memberId,
      table.raceId
    ),
  })
);

export type LeagueMember = typeof leagueMembers.$inferSelect;
export type NewLeagueMember = typeof leagueMembers.$inferInsert;
export type MemberRaceTeam = typeof memberRaceTeams.$inferSelect;
export type NewMemberRaceTeam = typeof memberRaceTeams.$inferInsert;
export type MemberRaceScore = typeof memberRaceScores.$inferSelect;
export type NewMemberRaceScore = typeof memberRaceScores.$inferInsert;

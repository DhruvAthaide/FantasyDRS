CREATE TABLE "circuits" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"overtake_difficulty" real DEFAULT 0.5,
	"high_speed" real DEFAULT 0.5,
	"street_circuit" boolean DEFAULT false,
	"altitude" integer DEFAULT 0,
	"avg_degradation" real DEFAULT 0.5
);
--> statement-breakpoint
CREATE TABLE "constructors" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	CONSTRAINT "constructors_ref_id_unique" UNIQUE("ref_id")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(3) NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"number" integer,
	"constructor_id" integer,
	"country" text,
	CONSTRAINT "drivers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fantasy_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_type" text NOT NULL,
	"asset_id" integer NOT NULL,
	"race_id" integer,
	"price" real NOT NULL,
	"price_change" real DEFAULT 0,
	"recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fantasy_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_type" text NOT NULL,
	"asset_id" integer NOT NULL,
	"race_id" integer,
	"session_type" text,
	"qualifying_pts" real DEFAULT 0,
	"race_position_pts" real DEFAULT 0,
	"positions_gained_pts" real DEFAULT 0,
	"overtake_pts" real DEFAULT 0,
	"fastest_lap_pts" real DEFAULT 0,
	"dotd_pts" real DEFAULT 0,
	"dnf_penalty" real DEFAULT 0,
	"pitstop_pts" real DEFAULT 0,
	"total_pts" real DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "pitstop_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"constructor_id" integer,
	"race_id" integer,
	"stop_number" integer DEFAULT 1,
	"time_seconds" real NOT NULL,
	"points_scored" real DEFAULT 0,
	"is_fastest" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "power_unit_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer,
	"component_type" text NOT NULL,
	"race_id" integer,
	"is_new" boolean DEFAULT true,
	"total_used" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer,
	"driver_id" integer,
	"qualifying_position" integer,
	"race_position" integer,
	"dnf" boolean DEFAULT false,
	"fastest_lap" boolean DEFAULT false,
	"dotd" boolean DEFAULT false,
	"overtakes" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" serial PRIMARY KEY NOT NULL,
	"round" integer NOT NULL,
	"name" text NOT NULL,
	"circuit_id" integer,
	"date" text,
	"has_sprint" boolean DEFAULT false,
	"laps" integer DEFAULT 57,
	"drs_zones" integer DEFAULT 3
);
--> statement-breakpoint
CREATE TABLE "simulation_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer,
	"asset_type" text NOT NULL,
	"asset_id" integer NOT NULL,
	"expected_pts_mean" real,
	"expected_pts_median" real,
	"expected_pts_std" real,
	"expected_pts_p10" real,
	"expected_pts_p90" real,
	"qpace_mean" real,
	"qpace_std" real,
	"rpace_mean" real,
	"rpace_std" real,
	"dnf_probability" real,
	"fl_probability" real,
	"simulated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_constructor_id_constructors_id_fk" FOREIGN KEY ("constructor_id") REFERENCES "public"."constructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fantasy_prices" ADD CONSTRAINT "fantasy_prices_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fantasy_scores" ADD CONSTRAINT "fantasy_scores_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitstop_results" ADD CONSTRAINT "pitstop_results_constructor_id_constructors_id_fk" FOREIGN KEY ("constructor_id") REFERENCES "public"."constructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitstop_results" ADD CONSTRAINT "pitstop_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_unit_allocations" ADD CONSTRAINT "power_unit_allocations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_unit_allocations" ADD CONSTRAINT "power_unit_allocations_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_circuit_id_circuits_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."circuits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "races_round_unique" ON "races" USING btree ("round");
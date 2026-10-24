CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`deadline` integer NOT NULL,
	`submitted_at` integer,
	`duration_minutes` integer NOT NULL,
	`status` text NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`score` real,
	`total_points` real NOT NULL,
	`correct_count` integer,
	`question_count` integer NOT NULL,
	`accuracy` real,
	`timed_out` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attempts_owner` ON `attempts` (`owner_id`);--> statement-breakpoint
CREATE INDEX `attempts_profile` ON `attempts` (`profile_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `profiles_owner` ON `profiles` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_owner_code` ON `profiles` (`owner_id`,`code`);
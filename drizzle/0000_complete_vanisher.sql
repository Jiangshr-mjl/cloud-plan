CREATE TABLE `planner` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`tasks` text DEFAULT '[]' NOT NULL
);

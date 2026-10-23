CREATE TABLE `work_days` (
	`day` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`intervals` text DEFAULT '[]' NOT NULL
);

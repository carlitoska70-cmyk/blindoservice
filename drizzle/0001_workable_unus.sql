CREATE TABLE `grants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`visit_id` text NOT NULL,
	`document_id` text NOT NULL,
	`file_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`version` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grants_visit_document` ON `grants` (`visit_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `request_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`visit_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_events_visit_time` ON `portal_events` (`visit_id`,`created`);--> statement-breakpoint
CREATE TABLE `portals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portals_owner` ON `portals` (`owner`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`portal_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	`inspection_id` text,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`last_seen` text NOT NULL,
	`active_doc` text,
	`active_page` integer
);
--> statement-breakpoint
CREATE INDEX `visits_owner_created` ON `visits` (`owner`,`created`);--> statement-breakpoint
CREATE UNIQUE INDEX `visits_token` ON `visits` (`token_hash`);
CREATE TABLE `measurement_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`measurement_id` text NOT NULL,
	`action` text NOT NULL,
	`snapshot` text NOT NULL,
	`revised_at_utc` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`kind` text NOT NULL,
	`instrument_id` text,
	`raw_value` real NOT NULL,
	`unit` text NOT NULL,
	`temp_c` real,
	`corrected_sg` real,
	`corrected_brix` real,
	`corrections` text NOT NULL,
	`measured_at_utc` text NOT NULL,
	`notes` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `instruments` ADD `calibration_temp_c` real;--> statement-breakpoint
ALTER TABLE `instruments` ADD `calibration_pair` text;
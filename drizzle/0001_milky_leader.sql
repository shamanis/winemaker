CREATE TABLE `batch_additions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`dose_amount` real,
	`dose_unit` text NOT NULL,
	`added_at_utc` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `batch_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`at_utc` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `batch_yeast` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`strain_id` text,
	`strain_name` text NOT NULL,
	`producer` text,
	`dose_amount` real,
	`dose_unit` text NOT NULL,
	`added_at_utc` text NOT NULL,
	`production_date_utc` text,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strain_id`) REFERENCES `yeast_strains`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`raw_material` text NOT NULL,
	`style` text,
	`volume_liters` real,
	`start_date_utc` text NOT NULL,
	`status` text NOT NULL,
	`start_params` text NOT NULL,
	`final_result` text,
	`created_at_utc` text NOT NULL,
	`archived_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`wcf` real,
	`calibration_offset_sg` real,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `yeast_strains` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`producer` text,
	`temp_min_c` real,
	`temp_max_c` real,
	`alcohol_tolerance_pct` real,
	`notes` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);

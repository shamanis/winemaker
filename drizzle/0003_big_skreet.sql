CREATE TABLE `batch_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`kind` text NOT NULL,
	`at_utc` text NOT NULL,
	`notes` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade
);

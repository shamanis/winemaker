ALTER TABLE `instruments` DROP COLUMN `calibration_offset_sg`;
--> statement-breakpoint
ALTER TABLE `instruments` ADD `calibration_offset_bx` real;

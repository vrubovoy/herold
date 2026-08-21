CREATE TABLE `mail_attachment_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`part_id` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `mail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_attachment_refs_message_idx` ON `mail_attachment_refs` (`message_id`);--> statement-breakpoint
CREATE TABLE `mail_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`special_use` text,
	`uid_validity` integer NOT NULL,
	`last_seen_uid` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_folders_account_idx` ON `mail_folders` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_folders_account_name_idx` ON `mail_folders` (`account_id`,`name`);--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`imap_uid` integer NOT NULL,
	`message_id` text,
	`subject` text,
	`from_address` text,
	`from_name` text,
	`to_addresses` text DEFAULT '[]' NOT NULL,
	`date` integer,
	`snippet` text DEFAULT '' NOT NULL,
	`body_text` text DEFAULT '' NOT NULL,
	`flags_seen` integer DEFAULT false NOT NULL,
	`flags_flagged` integer DEFAULT false NOT NULL,
	`flags_deleted` integer DEFAULT false NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `mail_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_messages_folder_idx` ON `mail_messages` (`folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_messages_folder_uid_idx` ON `mail_messages` (`folder_id`,`imap_uid`);
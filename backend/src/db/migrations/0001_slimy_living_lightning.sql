CREATE TABLE `mail_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`imap_security` text NOT NULL,
	`imap_username` text NOT NULL,
	`imap_password_encrypted` text NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`smtp_security` text NOT NULL,
	`smtp_username` text NOT NULL,
	`smtp_password_encrypted` text NOT NULL,
	`from_name` text NOT NULL,
	`from_email` text NOT NULL,
	`sync_state` text DEFAULT 'pending' NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_accounts_user_idx` ON `mail_accounts` (`user_id`);
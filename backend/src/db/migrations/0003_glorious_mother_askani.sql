ALTER TABLE `mail_accounts` ADD `sent_filing_mode` text DEFAULT 'provider' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_messages` ADD `reconciliation_state` text DEFAULT 'synced' NOT NULL;--> statement-breakpoint
CREATE INDEX `mail_messages_message_id_idx` ON `mail_messages` (`folder_id`,`message_id`);
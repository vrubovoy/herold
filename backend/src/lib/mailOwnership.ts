import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { mailAccounts, mailFolders, mailMessages, type MailAccount, type MailFolder, type MailMessage } from '../db/schema.js'

// Shared ownership-scoped lookups - every mail resource (folder,
// message, attachment) traces back to an account, which is the only
// thing directly tied to a user id, so "does this belong to the
// caller" always means walking that chain rather than a direct column
// check. Centralized here rather than duplicated per router so
// accounts/folders/messages all enforce it identically.

export function getOwnedAccount(userId: string, accountId: string): MailAccount | undefined {
  return db.select().from(mailAccounts)
    .where(and(eq(mailAccounts.id, accountId), eq(mailAccounts.userId, userId)))
    .get()
}

export function getOwnedFolder(userId: string, folderId: string): MailFolder | undefined {
  const row = db.select({ folder: mailFolders })
    .from(mailFolders)
    .innerJoin(mailAccounts, eq(mailFolders.accountId, mailAccounts.id))
    .where(and(eq(mailFolders.id, folderId), eq(mailAccounts.userId, userId)))
    .get()
  return row?.folder
}

export function getOwnedMessage(userId: string, messageId: string): { message: MailMessage; folder: MailFolder; account: MailAccount } | undefined {
  const row = db.select({ message: mailMessages, folder: mailFolders, account: mailAccounts })
    .from(mailMessages)
    .innerJoin(mailFolders, eq(mailMessages.folderId, mailFolders.id))
    .innerJoin(mailAccounts, eq(mailFolders.accountId, mailAccounts.id))
    .where(and(eq(mailMessages.id, messageId), eq(mailAccounts.userId, userId)))
    .get()
  return row
}

import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('ap_like')
    .addColumn('notifiedAt', 'text')
    .execute()

  await db.schema
    .alterTable('ap_repost')
    .addColumn('notifiedAt', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('ap_like').dropColumn('notifiedAt').execute()

  await db.schema.alterTable('ap_repost').dropColumn('notifiedAt').execute()
}

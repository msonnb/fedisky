import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('ap_follow')
    .addColumn('actorSharedInbox', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('ap_follow')
    .dropColumn('actorSharedInbox')
    .execute()
}

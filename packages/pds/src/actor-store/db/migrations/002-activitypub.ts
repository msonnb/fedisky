import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('activitypub_key_pair')
    .addColumn('type', 'varchar', (col) =>
      col
        .notNull()
        .check(sql`type in ('RSASSA-PKCS1-v1_5', 'Ed25519')`)
        .primaryKey(),
    )
    .addColumn('publicKey', 'varchar', (col) => col.notNull())
    .addColumn('privateKey', 'varchar', (col) => col.notNull())
    .addColumn('createdAt', 'varchar', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('activitypub_follow')
    .addColumn('activityId', 'varchar', (col) => col.primaryKey())
    .addColumn('actorUri', 'varchar', (col) => col.notNull())
    .addColumn('actorInbox', 'varchar', (col) =>
      col
        .notNull()
        .check(sql`actorInbox like 'https://%' or actorInbox like 'http://%'`),
    )
    .addColumn('createdAt', 'varchar', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('activitypub_key_pair').execute()
  await db.schema.dropTable('activitypub_follow').execute()
}

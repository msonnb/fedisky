import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ap_bluesky_bridge_account')
    .addColumn('id', 'integer', (col) => col.primaryKey().notNull())
    .addColumn('did', 'text', (col) => col.notNull())
    .addColumn('handle', 'text', (col) => col.notNull())
    .addColumn('password', 'text', (col) => col.notNull())
    .addColumn('accessJwt', 'text', (col) => col.notNull())
    .addColumn('refreshJwt', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addColumn('updatedAt', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('ap_monitored_post')
    .addColumn('atUri', 'text', (col) => col.primaryKey().notNull())
    .addColumn('authorDid', 'text', (col) => col.notNull())
    .addColumn('lastChecked', 'text')
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('ap_monitored_post_author_did_idx')
    .on('ap_monitored_post')
    .column('authorDid')
    .execute()

  await db.schema
    .createIndex('ap_monitored_post_last_checked_idx')
    .on('ap_monitored_post')
    .column('lastChecked')
    .execute()

  await db.schema
    .createTable('ap_external_reply')
    .addColumn('atUri', 'text', (col) => col.primaryKey().notNull())
    .addColumn('parentAtUri', 'text', (col) => col.notNull())
    .addColumn('authorDid', 'text', (col) => col.notNull())
    .addColumn('apNoteId', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('ap_external_reply_parent_at_uri_idx')
    .on('ap_external_reply')
    .column('parentAtUri')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ap_external_reply').execute()
  await db.schema.dropTable('ap_monitored_post').execute()
  await db.schema.dropTable('ap_bluesky_bridge_account').execute()
}

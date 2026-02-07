import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ap_like')
    .addColumn('activityId', 'text', (col) => col.primaryKey().notNull())
    .addColumn('postAtUri', 'text', (col) => col.notNull())
    .addColumn('postAuthorDid', 'text', (col) => col.notNull())
    .addColumn('apActorId', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('ap_like_post_at_uri_idx')
    .on('ap_like')
    .column('postAtUri')
    .execute()

  await db.schema
    .createIndex('ap_like_ap_actor_id_idx')
    .on('ap_like')
    .column('apActorId')
    .execute()

  await db.schema
    .createTable('ap_repost')
    .addColumn('activityId', 'text', (col) => col.primaryKey().notNull())
    .addColumn('postAtUri', 'text', (col) => col.notNull())
    .addColumn('postAuthorDid', 'text', (col) => col.notNull())
    .addColumn('apActorId', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('ap_repost_post_at_uri_idx')
    .on('ap_repost')
    .column('postAtUri')
    .execute()

  await db.schema
    .createIndex('ap_repost_ap_actor_id_idx')
    .on('ap_repost')
    .column('apActorId')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ap_repost').execute()
  await db.schema.dropTable('ap_like').execute()
}

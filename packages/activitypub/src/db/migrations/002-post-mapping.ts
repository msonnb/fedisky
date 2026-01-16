import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ap_post_mapping')
    .addColumn('atUri', 'text', (col) => col.primaryKey().notNull())
    .addColumn('apNoteId', 'text', (col) => col.notNull())
    .addColumn('apActorId', 'text', (col) => col.notNull())
    .addColumn('apActorInbox', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('ap_post_mapping_ap_note_id_idx')
    .on('ap_post_mapping')
    .column('apNoteId')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ap_post_mapping').execute()
}

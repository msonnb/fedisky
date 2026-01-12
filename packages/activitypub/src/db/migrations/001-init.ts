import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ap_follow')
    .addColumn('userDid', 'text', (col) => col.notNull())
    .addColumn('activityId', 'text', (col) => col.notNull())
    .addColumn('actorUri', 'text', (col) => col.notNull())
    .addColumn('actorInbox', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('ap_follow_pkey', ['userDid', 'actorUri'])
    .execute()

  await db.schema
    .createIndex('ap_follow_user_did_idx')
    .on('ap_follow')
    .column('userDid')
    .execute()

  await db.schema
    .createTable('ap_key_pair')
    .addColumn('userDid', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('publicKey', 'text', (col) => col.notNull())
    .addColumn('privateKey', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('ap_key_pair_pkey', ['userDid', 'type'])
    .execute()

  await db.schema
    .createTable('ap_bridge_account')
    .addColumn('id', 'integer', (col) => col.primaryKey().notNull())
    .addColumn('did', 'text', (col) => col.notNull())
    .addColumn('handle', 'text', (col) => col.notNull())
    .addColumn('password', 'text', (col) => col.notNull())
    .addColumn('accessJwt', 'text', (col) => col.notNull())
    .addColumn('refreshJwt', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addColumn('updatedAt', 'text', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ap_bridge_account').execute()
  await db.schema.dropTable('ap_key_pair').execute()
  await db.schema.dropTable('ap_follow').execute()
}

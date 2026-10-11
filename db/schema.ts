import { sqliteTable, text, index, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const profiles = sqliteTable('profiles', {
  owner: text('owner').primaryKey(),
  data: text('data').notNull(),
  updated: text('updated').notNull(),
});
export const records = sqliteTable(
  'records',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    kind: text('kind').notNull(),
    data: text('data').notNull(),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
  },
  t => [index('records_owner_kind').on(t.owner, t.kind)],
);
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    created: text('created').notNull(),
  },
  t => [index('files_owner').on(t.owner)],
);

export const portals = sqliteTable(
  'portals',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    enabled: integer('enabled').notNull().default(0),
    created: text('created').notNull(),
  },
  t => [uniqueIndex('portals_owner').on(t.owner)],
);
export const visits = sqliteTable(
  'visits',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    portalId: text('portal_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull(),
    data: text('data').notNull(),
    inspectionId: text('inspection_id'),
    created: text('created').notNull(),
    expires: text('expires').notNull(),
    lastSeen: text('last_seen').notNull(),
    activeDoc: text('active_doc'),
    activePage: integer('active_page'),
  },
  t => [index('visits_owner_created').on(t.owner, t.created), uniqueIndex('visits_token').on(t.tokenHash)],
);
export const grants = sqliteTable(
  'grants',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    visitId: text('visit_id').notNull(),
    documentId: text('document_id').notNull(),
    fileId: text('file_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    version: text('version').notNull(),
    created: text('created').notNull(),
  },
  t => [uniqueIndex('grants_visit_document').on(t.visitId, t.documentId)],
);
export const portalEvents = sqliteTable(
  'portal_events',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    visitId: text('visit_id').notNull(),
    kind: text('kind').notNull(),
    data: text('data').notNull(),
    created: text('created').notNull(),
  },
  t => [index('portal_events_visit_time').on(t.visitId, t.created)],
);
export const limits = sqliteTable('request_limits', {
  id: text('id').primaryKey(),
  count: integer('count').notNull(),
  expires: integer('expires').notNull(),
});

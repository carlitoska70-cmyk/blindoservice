// Data retention (art. 5.1.e GDPR) for inspections and portal sessions.
// Rule: 120 days after the last activity of an inspection its personal data go away: portal sessions,
// notes, audio, transcripts, AI drafts and reports are deleted, the file keeps only authority, scope,
// dates and outcome (the officers' names are cleared). «Procedimento in corso» blocks the deletion
// until the owner marks it closed; then it runs 30 days later. Visits never linked to an inspection
// follow the same 120 days. Runs from the Worker Cron at most once every 20 hours.
// Self-contained (no imports) so the Node tests can load it directly.

export const CONTROL_DAYS = 120;
export const RELEASE_DAYS = 30;
export const WARN_DAYS = 14;
export const RUN_EVERY_HOURS = 20;
/** Records that belong to one inspection file and are deleted with its personal data. */
export const CHILD_KINDS = ['event', 'transcript', 'review', 'live_segment', 'live_hint', 'report'] as const;
/** Data fields of the children that point to an uploaded file (audio, attachments, PDF reports). */
const FILE_FIELDS = ['fileId', 'audioFileId', 'pdfFileId'] as const;
const DAY = 86_400_000;

export type Hold = { dal: string; riferimento: string; nota: string };
/** Retention fields of an inspection file, set by the server only (never by the edit form). */
export type InspectionRetention = { procedimento?: Hold; procedimentoChiuso?: string; anonimizzato?: string };
export const RETENTION_FIELDS = ['procedimento', 'procedimentoChiuso', 'anonimizzato'] as const;

export type Row = { id: string; kind: string; data: any; created: string; updated?: string };
export type VisitRow = { id: string; inspection_id: string | null; created: string; last_seen: string };
export type Due = {
  /** ISO time after which the data go away; null while a proceeding is open. */
  due: string | null;
  reason: 'procedimento' | 'chiuso' | 'attivita';
};

const time = (v: unknown) => (typeof v === 'string' && v ? Date.parse(v) : NaN);
const latest = (values: unknown[]) =>
  values.map(time).reduce((max, t) => (isNaN(t) || t <= max ? max : t), -Infinity);

/** When the personal data of one inspection file can be deleted. */
export function inspectionDue(inspection: Row, children: Row[] = [], visits: VisitRow[] = []): Due {
  const d = inspection.data || {};
  if (d.procedimento && !d.procedimentoChiuso) return { due: null, reason: 'procedimento' };
  if (d.procedimentoChiuso) {
    const closed = time(d.procedimentoChiuso);
    if (!isNaN(closed)) return { due: new Date(closed + RELEASE_DAYS * DAY).toISOString(), reason: 'chiuso' };
  }
  const last = latest([
    d.ended,
    d.started,
    inspection.created,
    ...children.map(c => c.created),
    ...visits.flatMap(v => [v.created, v.last_seen]),
  ]);
  const base = isFinite(last) ? last : Date.now();
  return { due: new Date(base + CONTROL_DAYS * DAY).toISOString(), reason: 'attivita' };
}

/** Portal session never linked to an inspection file. */
export const visitDue = (v: VisitRow) =>
  new Date(latest([v.created, v.last_seen]) + CONTROL_DAYS * DAY).toISOString();

export type Plan = {
  /** Inspection files whose personal data go now. */
  purge: { id: string; due: string }[];
  /** Due within WARN_DAYS: shown in the overview so the owner can block them. */
  warn: { id: string; due: string }[];
  /** Files with an open proceeding (kept until the owner closes it). */
  held: string[];
  /** Portal sessions without an inspection file, to delete now. */
  visits: string[];
};

export function retentionPlan(input: {
  now: Date;
  inspections: Row[];
  children: Row[];
  visits: VisitRow[];
}): Plan {
  const now = input.now.getTime();
  const plan: Plan = { purge: [], warn: [], held: [], visits: [] };
  for (const insp of input.inspections) {
    if (insp.data?.anonimizzato) continue;
    const kids = input.children.filter(c => c.data?.inspectionId === insp.id);
    const due = inspectionDue(
      insp,
      kids,
      input.visits.filter(v => v.inspection_id === insp.id),
    );
    if (!due.due) plan.held.push(insp.id);
    else if (Date.parse(due.due) <= now) plan.purge.push({ id: insp.id, due: due.due });
    else if (Date.parse(due.due) - now <= WARN_DAYS * DAY) plan.warn.push({ id: insp.id, due: due.due });
  }
  const files = new Set(input.inspections.map(i => i.id));
  for (const v of input.visits)
    if ((!v.inspection_id || !files.has(v.inspection_id)) && Date.parse(visitDue(v)) <= now)
      plan.visits.push(v.id);
  return plan;
}

/** File ids referenced by the children of an inspection. */
export function childFiles(children: Row[]) {
  const ids = new Set<string>();
  for (const c of children)
    for (const f of FILE_FIELDS) {
      const v = c.data?.[f];
      if (typeof v === 'string' && v) ids.add(v);
    }
  return [...ids];
}

/** What the retention run keeps for the owner: shown in the app and used as a sync marker. */
export type RetentionState = {
  lastRun: string;
  /** Time of the last deletion: clients with an older sync cursor reload everything. */
  lastPurge: string;
  last: { controlli: number; sessioni: number; file: number; documenti: number };
  history: { at: string; controlli: number; sessioni: number; file: number; documenti: number }[];
};
export const retentionId = (owner: string) => 'retention:' + owner;

type Env = { DB?: D1Database; BUCKET?: R2Bucket };
type Counts = RetentionState['last'];
const parse = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

async function readState(db: D1Database, owner: string): Promise<RetentionState | null> {
  const r = await db
    .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='retention'")
    .bind(retentionId(owner), owner)
    .first<{ data: string }>();
  return r ? parse(r.data) : null;
}

/**
 * Records a deletion (and, for the nightly run, the run itself) for the owner.
 * A deletion confirmed by the owner (`run: false`) does not move the nightly schedule.
 */
export async function writeState(
  db: D1Database,
  owner: string,
  now: string,
  counts: Counts | null,
  { run = true } = {},
) {
  const prev = await readState(db, owner);
  const removed = counts && Object.values(counts).some(n => n > 0);
  const state: RetentionState = {
    lastRun: run ? now : prev?.lastRun || '',
    lastPurge: removed ? now : prev?.lastPurge || '',
    last: run
      ? counts || { controlli: 0, sessioni: 0, file: 0, documenti: 0 }
      : prev?.last || { controlli: 0, sessioni: 0, file: 0, documenti: 0 },
    history: removed ? [{ at: now, ...counts! }, ...(prev?.history || [])].slice(0, 20) : prev?.history || [],
  };
  await db
    .prepare(
      "INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,'retention',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated",
    )
    .bind(retentionId(owner), owner, JSON.stringify(state), now, now)
    .run();
  return state;
}

/**
 * Deletes uploaded files no longer referenced by any record of the owner (other than `gone`).
 * A file shared with an archive document is kept.
 */
export async function dropFiles(env: Env, owner: string, fileIds: string[], gone: Set<string>) {
  const db = env.DB!;
  let dropped = 0;
  for (const fileId of fileIds) {
    const users = await db
      .prepare('SELECT id FROM records WHERE owner=? AND instr(data,?)>0')
      .bind(owner, fileId)
      .all<{ id: string }>();
    if (users.results.some(u => !gone.has(u.id))) continue;
    const f = await db
      .prepare('SELECT object_key FROM files WHERE id=? AND owner=?')
      .bind(fileId, owner)
      .first<{ object_key: string }>();
    if (!f) continue;
    await env.BUCKET?.delete(f.object_key);
    await db.prepare('DELETE FROM files WHERE id=? AND owner=?').bind(fileId, owner).run();
    dropped++;
  }
  return dropped;
}

async function dropVisits(db: D1Database, owner: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    await db.batch([
      db
        .prepare(`DELETE FROM grants WHERE owner=? AND visit_id IN (${marks(part.length)})`)
        .bind(owner, ...part),
      db
        .prepare(`DELETE FROM portal_events WHERE owner=? AND visit_id IN (${marks(part.length)})`)
        .bind(owner, ...part),
      db.prepare(`DELETE FROM visits WHERE owner=? AND id IN (${marks(part.length)})`).bind(owner, ...part),
    ]);
  }
}

/** Removes the personal data of one inspection file now. */
export async function purgeInspection(env: Env, owner: string, inspectionId: string, now: string) {
  const db = env.DB!;
  const kids = await db
    .prepare(
      `SELECT id,kind,data,created FROM records WHERE owner=? AND kind IN (${marks(CHILD_KINDS.length)}) AND json_extract(data,'$.inspectionId')=?`,
    )
    .bind(owner, ...CHILD_KINDS, inspectionId)
    .all<{ id: string; kind: string; data: string; created: string }>();
  const children = kids.results.map(k => ({ ...k, data: parse(k.data) || {} }));
  const files = childFiles(children);
  const visits = await db
    .prepare('SELECT id FROM visits WHERE owner=? AND inspection_id=?')
    .bind(owner, inspectionId)
    .all<{ id: string }>();
  const ids = children.map(c => c.id);
  // Listening log of the audio files that go away.
  const logs = files.length
    ? await db
        .prepare(
          `SELECT id FROM records WHERE owner=? AND kind='ascolto' AND json_extract(data,'$.fileId') IN (${marks(files.length)})`,
        )
        .bind(owner, ...files)
        .all<{ id: string }>()
    : { results: [] as { id: string }[] };
  ids.push(...logs.results.map(l => l.id));
  const gone = new Set([inspectionId, ...ids]);
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    await db.batch([
      db
        .prepare(
          `DELETE FROM records WHERE owner=? AND kind='revision' AND json_extract(data,'$.recordId') IN (${marks(part.length)})`,
        )
        .bind(owner, ...part),
      db.prepare(`DELETE FROM records WHERE owner=? AND id IN (${marks(part.length)})`).bind(owner, ...part),
    ]);
  }
  // The file stays as a short history: who checked, about what, when, with which outcome.
  await db.batch([
    db
      .prepare("DELETE FROM records WHERE owner=? AND kind='revision' AND json_extract(data,'$.recordId')=?")
      .bind(owner, inspectionId),
    db
      .prepare(
        "UPDATE records SET data=json_remove(json_set(data,'$.officers','','$.status','concluso','$.ended',CASE WHEN coalesce(json_extract(data,'$.ended'),'')='' THEN ? ELSE json_extract(data,'$.ended') END,'$.anonimizzato',?),'$.procedimento'),updated=? WHERE id=? AND owner=? AND kind='inspection'",
      )
      .bind(now, now, now, inspectionId, owner),
  ]);
  await dropVisits(
    db,
    owner,
    visits.results.map(v => v.id),
  );
  const dropped = await dropFiles(env, owner, files, gone);
  return { records: ids.length, visits: visits.results.length, files: dropped };
}

/**
 * Nightly run from the Worker Cron. Never throws: a failure is only logged and retried at the next run.
 * `force` skips the 20-hour spacing (tests, manual run).
 */
export async function runRetention(env: Env, now = new Date(), force = false) {
  const db = env.DB;
  if (!db) return { ok: false, error: 'database non disponibile' };
  try {
    const owners = await db
      .prepare(
        "SELECT DISTINCT owner FROM records WHERE kind='inspection' UNION SELECT DISTINCT owner FROM visits",
      )
      .all<{ owner: string }>();
    const iso = now.toISOString();
    const report: Record<string, Counts> = {};
    for (const { owner } of owners.results) {
      const prev = await readState(db, owner);
      if (!force && prev?.lastRun && now.getTime() - Date.parse(prev.lastRun) < RUN_EVERY_HOURS * 3600_000)
        continue;
      const [ins, kids, vis] = await Promise.all([
        db
          .prepare("SELECT id,kind,data,created FROM records WHERE owner=? AND kind='inspection'")
          .bind(owner)
          .all<{ id: string; kind: string; data: string; created: string }>(),
        db
          .prepare(
            `SELECT id,kind,json_object('inspectionId',json_extract(data,'$.inspectionId')) AS data,created FROM records WHERE owner=? AND kind IN (${marks(CHILD_KINDS.length)})`,
          )
          .bind(owner, ...CHILD_KINDS)
          .all<{ id: string; kind: string; data: string; created: string }>(),
        db
          .prepare('SELECT id,inspection_id,created,last_seen FROM visits WHERE owner=?')
          .bind(owner)
          .all<VisitRow>(),
      ]);
      const plan = retentionPlan({
        now,
        inspections: ins.results.map(r => ({ ...r, data: parse(r.data) || {} })),
        children: kids.results.map(r => ({ ...r, data: parse(r.data) || {} })),
        visits: vis.results,
      });
      const counts: Counts = { controlli: 0, sessioni: 0, file: 0, documenti: 0 };
      for (const p of plan.purge) {
        const r = await purgeInspection(env, owner, p.id, iso);
        counts.controlli++;
        counts.sessioni += r.visits;
        counts.file += r.files;
      }
      if (plan.visits.length) {
        await dropVisits(db, owner, plan.visits);
        counts.sessioni += plan.visits.length;
      }
      await writeState(db, owner, iso, counts);
      report[owner.slice(0, 8)] = counts;
    }
    return { ok: true, report };
  } catch (e) {
    console.error('retention failed', e instanceof Error ? e.message : 'unknown');
    return { ok: false, error: 'pulizia non riuscita' };
  }
}

import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { body, db, digest, failure, origin, owner, response } from '@/lib/portal-server';
import { newKey, SCOPES, type Scope } from '@/lib/integration';
import { confirmedDocumentSchema } from '@/lib/document-schema';
import { employeeSchema } from '@/lib/schemas';
import { categories } from '@/lib/product';
export const dynamic = 'force-dynamic';

/** Owner view: keys of the holding software and proposals waiting for a decision. */
export async function GET() {
  try {
    const uid = await owner();
    const [keys, inbox] = await Promise.all([
      db()
        .prepare(
          'SELECT id,name,scopes,created,last_used,revoked FROM integration_keys WHERE owner=? ORDER BY created',
        )
        .bind(uid)
        .all<any>(),
      db()
        .prepare(
          "SELECT id,source,kind,external_key,data,file_id,status,created,decided,record_id FROM integration_inbox WHERE owner=? ORDER BY CASE status WHEN 'in_attesa' THEN 0 ELSE 1 END, created DESC LIMIT 80",
        )
        .bind(uid)
        .all<any>(),
    ]);
    return response({
      scopes: SCOPES,
      keys: keys.results.map(k => ({ ...k, scopes: JSON.parse(k.scopes) })),
      inbox: inbox.results.map(i => ({ ...i, data: JSON.parse(i.data) })),
    });
  } catch (e) {
    return failure(e);
  }
}

async function insertRecord(uid: string, kind: string, data: unknown) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await db()
    .prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)')
    .bind(id, uid, kind, JSON.stringify(data), now, now)
    .run();
  return id;
}

async function updateRecord(uid: string, id: string, kind: string, data: unknown) {
  const now = new Date().toISOString();
  await db().batch([
    db()
      .prepare(
        "INSERT INTO records(id,owner,kind,data,created,updated) SELECT ?,owner,'revision',json_object('recordId',id,'kind',kind,'data',json(data),'updated',updated),?,? FROM records WHERE id=? AND owner=? AND kind=?",
      )
      .bind(crypto.randomUUID(), now, now, id, uid, kind),
    db()
      .prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND kind=?')
      .bind(JSON.stringify(data), now, id, uid, kind),
  ]);
}

async function findEmployee(uid: string, source: string, externalId: string) {
  const row = await db()
    .prepare(
      "SELECT id,data FROM records WHERE owner=? AND kind='employee' AND json_extract(data,'$.externalSource')=? AND json_extract(data,'$.externalId')=?",
    )
    .bind(uid, source, externalId)
    .first<{ id: string; data: string }>();
  return row ? { id: row.id, data: JSON.parse(row.data) } : null;
}

export async function POST(req: Request) {
  try {
    origin(req);
    const uid = await owner();
    const b = await body(req);
    const now = new Date().toISOString();
    if (b.action === 'create-key') {
      const name = z.string().trim().min(2).max(60).parse(b.name);
      const scopes = z
        .array(z.enum(Object.keys(SCOPES) as [Scope, ...Scope[]]))
        .min(1)
        .parse(b.scopes);
      const token = newKey();
      await db()
        .prepare('INSERT INTO integration_keys(id,owner,name,key_hash,scopes,created) VALUES(?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), uid, name, await digest(token), JSON.stringify(scopes), now)
        .run();
      // The key is shown once; only its hash is stored.
      return response({ ok: true, token });
    }
    if (b.action === 'revoke-key') {
      const id = z.string().max(100).parse(b.id);
      await db()
        .prepare('UPDATE integration_keys SET revoked=? WHERE id=? AND owner=?')
        .bind(now, id, uid)
        .run();
      return response({ ok: true });
    }
    const id = z.string().max(100).parse(b.id);
    const item = await db()
      .prepare("SELECT * FROM integration_inbox WHERE id=? AND owner=? AND status='in_attesa'")
      .bind(id, uid)
      .first<any>();
    if (!item) return response({ error: 'Proposta non trovata o già decisa' }, 404);
    const data = JSON.parse(item.data);
    const externalId = item.external_key.replace(/^[a-z]+:/, '');
    if (b.action === 'reject') {
      await db()
        .prepare("UPDATE integration_inbox SET status='scartata',decided=? WHERE id=?")
        .bind(now, id)
        .run();
      if (item.file_id) {
        const f = await db()
          .prepare('SELECT object_key FROM files WHERE id=? AND owner=?')
          .bind(item.file_id, uid)
          .first<any>();
        const used = await db()
          .prepare(
            "SELECT id FROM records WHERE owner=? AND kind='document' AND json_extract(data,'$.fileId')=?",
          )
          .bind(uid, item.file_id)
          .first();
        if (f && !used) {
          await env.BUCKET?.delete(f.object_key);
          await db().prepare('DELETE FROM files WHERE id=? AND owner=?').bind(item.file_id, uid).run();
        }
      }
      return response({ ok: true });
    }
    if (b.action !== 'accept') return response({ error: 'Operazione non valida' }, 400);
    let recordId: string;
    if (item.kind === 'dipendente') {
      const existing = await findEmployee(uid, item.source, externalId);
      const merged = employeeSchema.parse({
        name: data.name,
        role: data.role,
        hired: data.hired,
        contract: data.contract,
        endDate: data.endDate,
        active: data.active,
        extraUe: existing?.data.extraUe ?? false,
        designations: existing?.data.designations ?? [],
        medicalRequired: existing?.data.medicalRequired ?? false,
        notes: existing?.data.notes ?? '',
        externalSource: item.source,
        externalId,
      });
      if (existing) {
        await updateRecord(uid, existing.id, 'employee', merged);
        recordId = existing.id;
      } else recordId = await insertRecord(uid, 'employee', merged);
    } else {
      const employee = data.employeeExternalId
        ? await findEmployee(uid, item.source, data.employeeExternalId)
        : null;
      const file = item.file_id
        ? await db()
            .prepare('SELECT name FROM files WHERE id=? AND owner=?')
            .bind(item.file_id, uid)
            .first<any>()
        : null;
      const doc = confirmedDocumentSchema.parse({
        title: data.title,
        category: categories.includes(data.category) ? data.category : 'Altro',
        documentType: data.documentType,
        issued: data.issued,
        expires: data.expires,
        holder: data.holder,
        vat: '',
        address: '',
        notes: (`Ricevuto da ${item.source} il ${now.slice(0, 10)}. ` + (data.notes || '')).slice(0, 4000),
        fileId: item.file_id || '',
        fileName: file?.name || '',
        reviewed: false,
        reviewer: '',
        protocol: '',
        ...(employee ? { employeeId: employee.id } : {}),
      });
      recordId = await insertRecord(uid, 'document', doc);
    }
    await db()
      .prepare("UPDATE integration_inbox SET status='accettata',decided=?,record_id=? WHERE id=?")
      .bind(now, recordId, id)
      .run();
    return response({ ok: true, recordId });
  } catch (e) {
    if (e instanceof z.ZodError) return response({ error: 'Dati non validi' }, 400);
    return failure(e);
  }
}

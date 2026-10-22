import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db } from '@/lib/portal-server';
import { authorize, integrationFailure } from '@/lib/integration';
import { EXHIBITABLE } from '@/lib/grants';
export const dynamic = 'force-dynamic';

const s = (max: number) => z.string().trim().max(max);
const date = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default('');
const SCHEMAS = {
  dipendente: z.object({
    name: s(120).min(1),
    role: s(120).default(''),
    hired: date,
    contract: s(60).default(''),
    endDate: date,
    active: z.boolean().default(true),
  }),
  documento: z.object({
    title: s(200).min(1),
    category: s(80).default('Altro'),
    documentType: s(200).default(''),
    issued: date,
    expires: date,
    holder: s(200).default(''),
    employeeExternalId: s(100).optional(),
    notes: s(2000).default(''),
  }),
};
const MAX_FILE = 20 * 1024 * 1024;

/**
 * A software of the holding proposes a document or employee data.
 * JSON {tipo, chiaveEsterna, dati} or multipart with the same fields (dati as JSON) and "file".
 * Re-sending the same chiaveEsterna updates the pending proposal instead of duplicating it.
 */
export async function POST(req: Request) {
  try {
    const key = await authorize(req, 'proposte:scrivi');
    const multipart = (req.headers.get('content-type') || '').startsWith('multipart/form-data');
    let tipo: string,
      chiave: string,
      dati: unknown,
      file: File | null = null;
    if (multipart) {
      const form = await req.formData();
      tipo = String(form.get('tipo') || '');
      chiave = String(form.get('chiaveEsterna') || '');
      dati = JSON.parse(String(form.get('dati') || '{}'));
      const f = form.get('file');
      file = f instanceof File ? f : null;
    } else {
      if (Number(req.headers.get('content-length') || 0) > 64000)
        return Response.json({ error: 'Richiesta troppo grande' }, { status: 413 });
      const b: any = await req.json();
      ({ tipo, chiaveEsterna: chiave, dati } = b);
    }
    if (tipo !== 'dipendente' && tipo !== 'documento')
      return Response.json({ error: 'tipo: dipendente o documento' }, { status: 400 });
    chiave = z.string().trim().min(1).max(100).parse(chiave);
    const data = SCHEMAS[tipo].parse(dati);
    let fileId: string | null = null;
    if (file) {
      if (tipo !== 'documento' || file.size === 0 || file.size > MAX_FILE || !EXHIBITABLE.includes(file.type))
        return Response.json({ error: 'File: PDF o immagine fino a 20 MB' }, { status: 400 });
      if (!env.BUCKET) return Response.json({ error: 'Archivio non disponibile' }, { status: 503 });
      const bytes = await file.arrayBuffer();
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x =>
        x.toString(16).padStart(2, '0'),
      ).join('');
      fileId = crypto.randomUUID();
      const objectKey = key.owner + '/' + fileId;
      await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
      await db()
        .prepare('INSERT INTO files(id,owner,name,mime,object_key,sha256,created) VALUES(?,?,?,?,?,?,?)')
        .bind(
          fileId,
          key.owner,
          (file.name || 'documento').slice(0, 255),
          file.type,
          objectKey,
          sha,
          new Date().toISOString(),
        )
        .run();
    }
    const now = new Date().toISOString();
    const previous = await db()
      .prepare(
        'SELECT id,file_id,status FROM integration_inbox WHERE owner=? AND source=? AND external_key=?',
      )
      .bind(key.owner, key.name, tipo + ':' + chiave)
      .first<{ id: string; file_id: string | null; status: string }>();
    if (previous) {
      await db()
        .prepare(
          "UPDATE integration_inbox SET data=?,file_id=COALESCE(?,file_id),status='in_attesa',created=?,decided=NULL,key_id=? WHERE id=?",
        )
        .bind(JSON.stringify(data), fileId, now, key.id, previous.id)
        .run();
      return Response.json({ ok: true, id: previous.id, aggiornata: true, stato: 'in_attesa' });
    }
    const id = crypto.randomUUID();
    await db()
      .prepare(
        'INSERT INTO integration_inbox(id,owner,key_id,source,kind,external_key,data,file_id,status,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        key.owner,
        key.id,
        key.name,
        tipo,
        tipo + ':' + chiave,
        JSON.stringify(data),
        fileId,
        'in_attesa',
        now,
      )
      .run();
    return Response.json({ ok: true, id, stato: 'in_attesa' }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: 'Dati non validi: ' + (e.issues[0]?.path.join('.') || '') },
        { status: 400 },
      );
    if (e instanceof SyntaxError) return Response.json({ error: 'JSON non valido' }, { status: 400 });
    return integrationFailure(e);
  }
}

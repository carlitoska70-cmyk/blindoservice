import { env } from 'cloudflare:workers';
import { getOperator as getChatGPTUser } from '@/lib/operator';
import { z } from 'zod';
import { defaultProfile, categories } from '@/lib/product';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'private, no-store'};
const json = (data:unknown,status=200)=>Response.json(data,{status,headers});
const str = (max=4000)=>z.string().max(max);
const date = z.union([z.literal(''),z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v)))]);
const doc = z.object({title:str(200).min(1),category:z.enum(categories as [string,...string[]]),expires:date,issued:date,vat:str(30),address:str(300),notes:str(),fileId:str(100),fileName:str(255),reviewed:z.boolean(),reviewer:str(200),protocol:str(200),catalogId:str(100).optional(),priority:z.enum(['Prioritario','Secondario','Opzionale']).optional(),publicDescription:str(500).optional()}).refine(v=>!v.reviewed||!!v.reviewer.trim(),'Indica chi ha effettuato la verifica.');
const inspection = z.object({authority:str(200).min(1),scope:str(200).min(1),officers:str(1000),reference:str(200),status:z.enum(['aperto','concluso']),outcome:str(),started:str(40),ended:str(40)});
const event = z.object({inspectionId:str(100).min(1),speaker:str(200),text:str().min(1),tag:z.enum(['Richiesta','Nota','Da verificare','Documento esibito','Registrazione']),offset:z.number().min(0).max(864000),fileId:str(100).optional(),fileName:str(255).optional()});
const requirement=z.object({catalogId:str(100),status:z.enum(['Da valutare','Applicabile','Non applicabile']),notes:str(),reviewer:str(200)});
const task = z.object({title:str(200).min(1),responsible:str(200),due:date,notes:str(),done:z.boolean()});
const profile = z.object({name:str(150).min(1),legalName:str(200),vat:str(30),address:str(300),city:str(100),region:str(100),activity:str(200),staff:z.enum(['Sì','No','Da confermare']),dehors:z.enum(['Sì','No','Da confermare']),reviewer:str(200),portalNotice:str(12000).optional()});
async function ctx(){const u=await getChatGPTUser();if(!u)throw new Error('AUTH');if(!env.DB)throw new Error('STORAGE');return {db:env.DB,owner:u.userId};}
function failure(e:unknown){if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||'Dati non validi'},400);if(e instanceof Error&&e.message==='AUTH')return json({error:'Accesso richiesto'},401);console.error('presidio state failed',e instanceof Error?e.message:'unknown');return json({error:'Archivio temporaneamente non disponibile. I campi restano compilati: riprova.'},503)}
export async function GET(){try{const {db,owner}=await ctx();const [p,r]=await Promise.all([db.prepare('SELECT data FROM profiles WHERE owner=?').bind(owner).first<{data:string}>(),db.prepare('SELECT id,kind,data,created,updated FROM records WHERE owner=? ORDER BY created DESC').bind(owner).all()]);return json({profile:p?JSON.parse(p.data):defaultProfile,records:r.results.map((x:any)=>({...x,data:JSON.parse(x.data)}))})}catch(e){return failure(e)}}
export async function POST(req:Request){
 try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Origine non valida'},403);
 const {db,owner}=await ctx();if(Number(req.headers.get('content-length')||0)>50000)return json({error:'Richiesta troppo grande'},413);
 const raw=await req.text();if(raw.length>50000)return json({error:'Richiesta troppo grande'},413);
 const b=JSON.parse(raw);const now=new Date().toISOString();
 if(b.action==='profile'){const data=profile.parse(b.data);await db.prepare('INSERT INTO profiles(owner,data,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data,updated=excluded.updated').bind(owner,JSON.stringify(data),now).run();return json({ok:true})}
 const kind=z.enum(['document','inspection','event','task','requirement']).parse(b.kind);
 const data=({document:doc,inspection, event,task,requirement}[kind]).parse(b.data);
 if(kind==='event'){
 const parent=await db.prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind((data as any).inspectionId,owner,'inspection').first<{data:string}>();
 if(!parent)return json({error:'Controllo non trovato'},404);
 if(JSON.parse(parent.data).status!=='aperto')return json({error:'Il fascicolo è concluso. Crea una nuova annotazione in un nuovo fascicolo.'},409);
 }
 if((data as any).fileId){const f=await db.prepare('SELECT id FROM files WHERE id=? AND owner=?').bind((data as any).fileId,owner).first();if(!f)return json({error:'Allegato non trovato'},400)}
 if(b.action==='update'){
 if(kind==='event')return json({error:'Le annotazioni sono append-only'},400);
 const id=str(100).parse(b.id);const version=str(40).parse(b.version);
 const results=await db.batch([
 db.prepare("INSERT INTO records(id,owner,kind,data,created,updated) SELECT ?,owner,'revision',json_object('recordId',id,'kind',kind,'data',json(data),'updated',updated),?,? FROM records WHERE id=? AND owner=? AND kind=? AND updated=?").bind(crypto.randomUUID(),now,now,id,owner,kind,version),
 db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND kind=? AND updated=?').bind(JSON.stringify(data),now,id,owner,kind,version)
 ]);const r=results[1];
 if(!r.meta.changes)return json({error:'Il record è cambiato. Ricarica i dati prima di salvarlo.'},409);
 return json({ok:true,id})
 }
 if(b.action!=='create')return json({error:'Operazione non valida'},400);
 const id=crypto.randomUUID();await db.prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)').bind(id,owner,kind,JSON.stringify(data),now,now).run();return json({ok:true,id})
 }catch(e){if(e instanceof SyntaxError)return json({error:'Richiesta non valida'},400);return failure(e)}
}

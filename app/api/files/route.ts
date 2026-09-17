import { env } from 'cloudflare:workers';
import { getOperator as getChatGPTUser } from '@/lib/operator';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Accesso richiesto'},{status:401});
 if(req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Origine non valida'},{status:403});
 if(!env.DB||!env.BUCKET)return Response.json({error:'Archivio allegati non disponibile'},{status:503});
 try{
 const max=20*1024*1024;if(Number(req.headers.get('content-length')||0)>max+65536)return Response.json({error:'Massimo 20 MB per allegato'},{status:413});
 const form=await req.formData();const file=form.get('file');if(!(file instanceof File)||file.size===0||file.size>max)return Response.json({error:'Scegli un file da 1 byte a 20 MB'},{status:400});
 if(!/^(application\/pdf|image\/(jpeg|png|webp)|audio\/(webm|mp4|mpeg|wav|x-wav|ogg))(;.*)?$/.test(file.type))return Response.json({error:'Formati ammessi: PDF, JPG, PNG, WebP, audio WebM, MP4, MP3, WAV, OGG.'},{status:400});
 const id=crypto.randomUUID(),key=user.userId+'/'+id;const bytes=await file.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});
 try{await env.DB.prepare('INSERT INTO files(id,owner,name,mime,object_key,sha256,created) VALUES(?,?,?,?,?,?,?)').bind(id,user.userId,file.name.slice(0,255),file.type,key,hash,new Date().toISOString()).run()}catch(e){await env.BUCKET.delete(key);throw e}
 return Response.json({id,name:file.name.slice(0,255),sha256:hash},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('file upload failed');return Response.json({error:'Salvataggio allegato non riuscito. Riprova.'},{status:503})}
}
export async function GET(req:Request){
 const user=await getChatGPTUser();if(!user)return new Response('Accesso richiesto',{status:401});
 if(!env.DB||!env.BUCKET)return new Response('Archivio non disponibile',{status:503});
 try{const id=new URL(req.url).searchParams.get('id');const f=await env.DB.prepare('SELECT name,mime,object_key,sha256 FROM files WHERE id=? AND owner=?').bind(id,user.userId).first<any>();if(!f)return new Response('Non trovato',{status:404});const object=await env.BUCKET.get(f.object_key);if(!object)return new Response('Allegato non disponibile',{status:404});
 return new Response(object.body,{headers:{'Content-Type':f.mime,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Content-SHA256':f.sha256,'Content-Security-Policy':"default-src 'none'; sandbox"}})
 }catch(e){return new Response('Archivio non disponibile',{status:503})}
}

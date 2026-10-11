import {env} from 'cloudflare:workers';
import {getOperator} from '@/lib/operator';
import {rate} from '@/lib/portal-server';
import {categories} from '@/lib/product';
import {handleRecognition} from '@/lib/document-recognition';
export function recognize(req:Request){return handleRecognition(req,{
 authorize:getOperator,apiKey:()=>env.OPENAI_API_KEY,categories,
 rate:uid=>rate('document-recognition:'+uid,600,3600),
 loadFile:async(id,uid)=>{
  if(!env.DB||!env.BUCKET)throw new Error('STORAGE');
  const row=await env.DB.prepare('SELECT mime,object_key FROM files WHERE id=? AND owner=?').bind(id,uid).first<{mime:string;object_key:string}>();
  if(!row)return null;const object=await env.BUCKET.get(row.object_key);if(!object)return null;
  return {mime:row.mime,size:object.size,arrayBuffer:()=>object.arrayBuffer()};
 }
})}

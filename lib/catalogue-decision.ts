import {catalogueMatches,normalized} from './catalogue-matching';
import type {MatchItem} from './catalogue-matching';
export function decideCatalogue(recognition:any,profile:any,items:MatchItem[]){
 const f=recognition?.fields||{},data={title:f.title?.value||'',documentType:f.documentType?.value||'',publicDescription:f.publicDescription?.value||'',recognition};
 const candidates=catalogueMatches(data,items).slice(0,5),best=candidates[0],reasons:string[]=[];
 if(recognition?.quality!=='leggibile')reasons.push('Lettura parziale o non leggibile.');
 if(!(f.title?.confidence==='alta'&&f.title?.evidence&&f.documentType?.confidence==='alta'&&f.documentType?.evidence))reasons.push('Titolo o tipo di documento non abbastanza sicuri.');
 if(recognition?.warnings?.length)reasons.push(...recognition.warnings.map((s:any)=>String(s).slice(0,400)));
 if(!best||best.score<90)reasons.push('Nessuna corrispondenza specifica sufficientemente forte.');
 if(best&&candidates[1]&&best.score-candidates[1].score<20)reasons.push('Più voci compatibili: serve una scelta.');
 const vat=(s:any)=>normalized(s).replace(/^it/,'').replace(/ /g,'');
 if(vat(profile?.vat)&&vat(f.vat?.value)&&vat(profile.vat)!==vat(f.vat.value))reasons.push('Partita IVA letta diversa dal profilo: verificare intestatario.');
 if(profile?.address&&f.address?.value&&normalized(profile.address)!==normalized(f.address.value))reasons.push('Sede letta da confrontare con il profilo.');
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'});
 if(f.expires?.value&&f.expires.value<today)reasons.push('La scadenza letta nel documento è superata: controlla anche la scheda.');
 if(f.issued?.value&&f.issued.value>today)reasons.push('La data di rilascio letta è futura.');
 if(f.issued?.value&&f.expires?.value&&f.expires.value<f.issued.value)reasons.push('Le date lette non sono coerenti.');
 return {ids:!reasons.length&&best?[best.id]:[],candidates,reasons};
}

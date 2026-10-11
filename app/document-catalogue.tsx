'use client';
import {useEffect,useMemo,useState} from 'react';
import {allCatalogue,reviewedCatalogue} from '@/lib/catalogue-index';
import {automaticCatalogueProposal,catalogLinks,catalogueMatches,withCatalogLinks,normalized} from '@/lib/catalogue-matching';
export default function DocumentCatalogue({value,onChange}:{value:any;onChange:(data:any)=>void}){
 const [query,setQuery]=useState('');
 const ids=catalogLinks(value),suggestions=useMemo(()=>catalogueMatches(value,reviewedCatalogue).slice(0,3),[value]);
 useEffect(()=>{const next=automaticCatalogueProposal(value,reviewedCatalogue);if(next!==value)onChange(next)},[value,onChange]);
 function set(ids:string[]){onChange({...withCatalogLinks(value,ids),catalogProposal:undefined,catalogMatchingDismissed:true})}
 const options=allCatalogue.filter(c=>normalized([c.title,c.area,...c.aliases].join(' ')).includes(normalized(query)));
 return <section className="panel" style={{padding:18,background:'#f4f7fc'}}><h2>Abbinamento al catalogo</h2><p className="muted">La proposta usa tipo e titolo letti nel documento. Confermi gli abbinamenti salvando la scheda; puoi collegarla a più voci.</p>
 {value.catalogProposal&&<p role="status" className="smallnote">Abbinamento proposto automaticamente · controlla che il documento corrisponda alla voce.</p>}
 {ids.map(id=><div className="row" key={id} style={{marginTop:10}}><strong style={{flex:1}}>{allCatalogue.find(c=>c.id===id)?.title||id}</strong><button type="button" className="textbutton" onClick={()=>set(ids.filter(x=>x!==id))}>Rimuovi abbinamento</button></div>)}
 {!ids.length&&<p className="smallnote">Nessun abbinamento confermato. I documenti ambigui richiedono una scelta.</p>}
 {!!suggestions.filter(s=>!ids.includes(s.id)).length&&<div style={{marginTop:14}}><p className="muted">Voci da confrontare</p>{suggestions.filter(s=>!ids.includes(s.id)).map(s=><button type="button" className="button secondary compact" key={s.id} disabled={ids.length>=20} style={{margin:4}} onClick={()=>set([...ids,s.id])}>{s.title}</button>)}</div>}
 <label className="field" style={{marginTop:16}}><span>Cerca nel catalogo</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Es. agibilità, HACCP, impianto gas"/></label>
 <label className="field"><span>Aggiungi una voce</span><select value="" style={{padding:12,maxWidth:'100%'}} onChange={e=>{if(e.target.value)set([...ids,e.target.value])}} disabled={ids.length>=20}><option value="">Scegli fra {options.length} voci…</option>{options.filter(c=>!ids.includes(c.id)).map(c=><option key={c.id} value={c.id}>{c.area} · {c.title}</option>)}</select></label>
 </section>;
}

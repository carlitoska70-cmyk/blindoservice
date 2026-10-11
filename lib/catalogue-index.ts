import * as previous from './catalogue';
import {inspectionCatalogue,type InspectionItem} from './inspection-catalogue';
import {normalized} from './catalogue-matching';
// Adapt the existing exported list without rewriting its IDs or stored assessments.
const legacy:InspectionItem[]=Object.values(previous).flatMap<unknown>(value=>Array.isArray(value)?value:[]).filter((v:any)=>v&&typeof v.id==='string'&&typeof v.title==='string'&&typeof v.category==='string').map((v:any)=>({
 ...v,description:String(v.description||v.title),condition:String(v.condition||'Applicabilità da valutare'),priority:v.priority||'Prioritario',source:String(v.source||'Riferimento da completare'),sourceIds:[],aliases:[],area:v.category,territory:'Da verificare',basis:'Catalogo precedente' as const,checkedOn:''
}));
// Only an exact title is merged. Similar items stay separate to avoid conflating legal instruments.
const used=new Set<string>();
export const reviewedCatalogue=inspectionCatalogue.map(item=>{
 const old=legacy.find(v=>normalized(v.title)===normalized(item.title));
 if(!old)return item;used.add(old.id);return {...item,id:old.id,category:old.category};
});
export const allCatalogue:InspectionItem[]=[...reviewedCatalogue,...legacy.filter(v=>!used.has(v.id))].filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i);

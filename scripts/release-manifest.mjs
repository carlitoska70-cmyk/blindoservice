import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ignored=new Set(['node_modules','.git','.wrangler','.sites-runtime','.vinext','.next','dist','out','backups','outputs','work','coverage','SOURCE_MANIFEST.json']);
const files={};
function walk(base){for(const e of fs.readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(ignored.has(e.name)||e.name.startsWith('.env')||e.name.startsWith('.dev.vars')||e.name.endsWith('.tsbuildinfo')||e.name==='.DS_Store')continue;const full=path.join(base,e.name);if(e.isSymbolicLink())throw new Error('Link non distribuibile: '+full);if(e.isDirectory())walk(full);else{const p=path.relative(root,full).split(path.sep).join('/');files[p]=createHash('sha256').update(fs.readFileSync(full)).digest('hex');}}}
walk(root);
const provenance=JSON.parse(fs.readFileSync(path.join(root,'PROVENIENZA.json'),'utf8'));
fs.writeFileSync(path.join(root,'SOURCE_MANIFEST.json'),JSON.stringify({product:'Presidio',pcRelease:provenance.pcRelease,sourceCommit:provenance.sourceCommit,generatedAt:new Date().toISOString(),files},null,2)+'\n');
console.log('Manifesto generato: '+Object.keys(files).length+' file. Non certifica autore o provenienza: verifica integrità rispetto al pacchetto.');

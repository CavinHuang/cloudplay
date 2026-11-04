#!/usr/bin/env node
// Conservative release notice report. Lists actual installed runtime packages
// and their license declarations. Review before commercial redistribution.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const roots=[path.join(repo,'node_modules')];
function moduleEntries(dir){
 if(!fs.existsSync(dir))return [];
 const result=[];
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
   if(entry.name.startsWith('@')){
     for(const sub of fs.readdirSync(path.join(dir,entry.name),{withFileTypes:true})){
       if(sub.isDirectory())result.push(path.join(dir,entry.name,sub.name));
     }
   } else result.push(path.join(dir,entry.name));
 }
 return result;
}

const seen=new Set(),items=[];
for(let i=0;i<roots.length;i++){
 const dir=roots[i];
 for(const entry of moduleEntries(dir)){
   const pkgFile=path.join(entry,'package.json');if(!fs.existsSync(pkgFile))continue;
   let pkg;try{pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'))}catch{continue}
   const key=`${pkg.name}@${pkg.version}`;
   if(!seen.has(key)){
     seen.add(key);
     const licenses=fs.readdirSync(entry).filter(x=>/^licen[cs]e(?:\.|$)|^copying(?:\.|$)|^notice(?:\.|$)/i.test(x));
     items.push({name:pkg.name,version:pkg.version,license:pkg.license||'UNKNOWN',licenseFiles:licenses,licenseTexts:licenses.filter(x=>fs.statSync(path.join(entry,x)).isFile()&&fs.statSync(path.join(entry,x)).size<200_000).map(x=>({file:x,text:fs.readFileSync(path.join(entry,x),'utf8')}))});
   }
   const nested=path.join(entry,'node_modules');if(fs.existsSync(nested))roots.push(nested);
 }
}
if(!items.length){console.error('No node_modules installed. Run npm ci in the builder first.');process.exit(1)}
items.sort((a,b)=>a.name.localeCompare(b.name)||String(a.version).localeCompare(String(b.version)));
console.log('# CloudPlay installed third-party dependency inventory\n# Check the individual licenses, copyright notices and package source before public distribution.');
for(const item of items){
 console.log(`\n==== ${item.name}@${item.version} | declared-license=${item.license} | included-license-files=${item.licenseFiles.join(',')||'NONE'} ====`);
 for(const part of item.licenseTexts)console.log(`--- ${part.file} ---\n${part.text}`);
}

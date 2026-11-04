#!/usr/bin/env node
/** Offline JS/JSX/TS parser. This is not a Next production build. */
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join,extname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
let ts;
try{ts=require('typescript')}
catch{
 try{ts=require(join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}
 catch{console.error('TypeScript parser not installed. Install TypeScript to perform syntax validation.');process.exit(2)}
}
const root=resolve('.');let files=0,errors=0;
function walk(directory){
 if(!existsSync(directory))return;
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  if(entry.name.startsWith('.')||entry.name==='node_modules'||entry.name==='dist')continue;
  const full=join(directory,entry.name);
  if(entry.isDirectory())walk(full);
  else if(['.js','.jsx','.ts','.tsx','.mjs'].includes(extname(full))){
   files++;
   const kind=({'.js':ts.ScriptKind.JS,'.jsx':ts.ScriptKind.JSX,'.mjs':ts.ScriptKind.JS,'.ts':ts.ScriptKind.TS,'.tsx':ts.ScriptKind.TSX})[extname(full)];
   const text=readFileSync(full,'utf8');const source=ts.createSourceFile(full,text,ts.ScriptTarget.ESNext,true,kind);
   for(const d of source.parseDiagnostics){errors++;const p=source.getLineAndCharacterOfPosition(d.start||0);console.error(`${full}:${p.line+1}:${p.character+1}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`)}
  }
 }
}
['app','components','lib','lab','scripts','integrations','tests'].forEach(x=>walk(join(root,x)));
console.log(JSON.stringify({mode:'syntax-parse-only',files,errors,productionBuildVerified:false}));
if(errors)process.exitCode=1;

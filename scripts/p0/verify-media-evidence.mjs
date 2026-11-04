#!/usr/bin/env node
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assessMediaEvidence,hasMinimalMediaEvidenceShape} from '../../lib/lab/media-evidence.mjs';

const filename=process.argv[2];
if(!filename){
  console.error('Usage: node scripts/p0/verify-media-evidence.mjs <media-evidence.json>');
  process.exitCode=2;
}else try {
  if(statSync(filename).size>1_000_000)throw Error('MEDIA_EVIDENCE_TOO_LARGE');
  const source=readFileSync(filename);
  const report=JSON.parse(source.toString('utf8'));
  if(!hasMinimalMediaEvidenceShape(report))throw Error('MEDIA_EVIDENCE_EXTRA_FIELDS_NOT_ALLOWED');
  const forbidden=/(?:candidate|password|secret|token|sdp|privateKey|ipAddress|remoteAddress|localAddress)/i;
  if(forbidden.test(JSON.stringify(report.samples||[])))throw Error('MEDIA_EVIDENCE_CONTAINS_SENSITIVE_FIELDS');
  const result=assessMediaEvidence(report);
  const output={...result,sha256:createHash('sha256').update(source).digest('hex'),
    audioTransportObserved:result.valid&&result.audioBytesIncreasing===true,
    acceptance:'WebRTC client counters only. Not independent proof of game image, audible sound, controls, or GPU host.',
  };
  console.log(JSON.stringify(output,null,2));
  if(!result.valid||!result.decodedVideoObserved||!result.audioBytesIncreasing)process.exitCode=1;
}catch(e){console.error('Media evidence invalid:',e.message);process.exitCode=1;}

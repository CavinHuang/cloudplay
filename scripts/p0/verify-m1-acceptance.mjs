#!/usr/bin/env node
import {verifyM1Index} from '../../lib/lab/m1-acceptance.mjs';
const filename=process.argv[2];
if(!filename){console.error('Usage: node scripts/p0/verify-m1-acceptance.mjs <m1-index.json>');process.exitCode=2;}
else{
 try{
  const report=verifyM1Index(filename);
  console.log(JSON.stringify(report,null,2));
  if(!report.readyForIndependentReview)process.exitCode=1;
 }catch(error){console.error(JSON.stringify({readyForIndependentReview:false,reason:error.message}));process.exitCode=1;}
}

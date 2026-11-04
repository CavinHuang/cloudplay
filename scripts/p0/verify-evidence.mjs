import {readFileSync, existsSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const filename=process.argv[2];
if (!filename) {
  console.error('Usage: node scripts/p0/verify-evidence.mjs <real-p0-evidence.json>');
  process.exitCode=2;
} else {
  try {
    const report=JSON.parse(readFileSync(filename,'utf8'));
    const requirements=['videoObserved','audioObserved','keyboardOrControllerObserved','successfulExitObserved'];
    const missing=requirements.filter(key=>report[key]!==true);
    if (report.game!=='supertuxkart') missing.push('game: supertuxkart');
    if (!report.observedAt || Number.isNaN(Date.parse(report.observedAt))) missing.push('observedAt');
    let evidenceFile=null,hash=null;
    if (typeof report.screenshotPath !== 'string' || !report.screenshotPath.trim()) missing.push('screenshotPath');
    else {
      evidenceFile=resolve(report.screenshotPath);
      if (!existsSync(evidenceFile) || !statSync(evidenceFile).isFile()) missing.push('screenshot file');
      else hash=createHash('sha256').update(readFileSync(evidenceFile)).digest('hex');
    }
    if (missing.length) {
      console.error('P0 MANUAL EVIDENCE INCOMPLETE:',missing.join(', '));
      console.error('The host heartbeat / open port is NOT sufficient to prove game streaming.');
      process.exitCode=1;
    } else {
      console.log(JSON.stringify({manualAttestationComplete:true, game:report.game, observedAt:report.observedAt, screenshotSha256:hash, note:'Validated user-provided attestations and file existence only; this script cannot independently prove video, sound or controls.'},null,2));
    }
  } catch (error) {console.error('Invalid evidence:',error.message);process.exitCode=1;}
}

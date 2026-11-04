import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync} from 'node:fs';
import {dirname, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

/** P0-only, local session metadata. Never stores credentials, executable paths or media. */
export function createSessionJournal(path) {
  if (!path || typeof path !== 'string' || !isAbsolute(path)) throw new Error('P0_SESSION_JOURNAL must be an absolute local path');
  function load() {
    if (!existsSync(path)) return null;
    let value;
    try { value = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new Error('P0_SESSION_JOURNAL_CORRUPT: backup or inspect the file before restarting'); }
    if (!value || value.schema !== 1 || !Array.isArray(value.sessions) || !Array.isArray(value.commands))
      throw new Error('P0_SESSION_JOURNAL_INVALID_SCHEMA');
    return value;
  }
  function save(snapshot) {
    const value = {...snapshot, schema:1, writtenAt:new Date().toISOString()};
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Error('P0_SESSION_JOURNAL_TOO_LARGE');
    mkdirSync(dirname(path), {recursive:true,mode:0o700});
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, encoded+'\n', {encoding:'utf8',mode:0o600,flag:'wx'});
      renameSync(temp,path);
      // Windows ignores POSIX mode; on POSIX explicitly restrict owner access.
      if (process.platform !== 'win32') chmodSync(path,0o600);
    } catch (err) {
      try { unlinkSync(temp); } catch {}
      throw err;
    }
  }
  return {load,save,path};
}

// Minimal PE executable format/architecture gate. This is NOT code signing,
// malware scanning or proof that the binary runs correctly on the target GPU.
import fs from 'node:fs';
export function inspectWindowsExecutable(filename){
  const b=fs.readFileSync(filename);
  if(b.length<0x100 || b.toString('ascii',0,2)!=='MZ')throw Error(`Not a Windows PE executable: ${filename}`);
  const offset=b.readUInt32LE(0x3c);
  if(offset<0x40 || offset+26>b.length || b.toString('ascii',offset,offset+4)!=='PE\x00\x00')throw Error(`Invalid Windows PE header: ${filename}`);
  const machine=b.readUInt16LE(offset+4), optional=b.readUInt16LE(offset+24);
  if(machine!==0x8664 || optional!==0x20b)throw Error(`Expected an x64 Windows PE32+ executable: ${filename}`);
  return {machine:'x64',format:'PE32+',size:b.length};
}

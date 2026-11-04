/** Version gates taken from pinned moonlight-web-stream package.json at
 * 7b9821430e07087f459db3db9aac550e1e9c9bff, not from CloudPlay's own
 * Node.js runtime requirements. The toolchains are intentionally distinct.
 */
export const UPSTREAM_MIN_NODE = '26.4.0';
export const UPSTREAM_MIN_NPM = '11.17.0';
export const UPSTREAM_NODE_MAX_MAJOR = 26;
export const UPSTREAM_NPM_MAX_MAJOR = 11;

export function versionTuple(input) {
  if(typeof input !== 'string')return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(input.trim());
  if(!match)return null;
  const parts=match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger)?parts:null;
}
export function compareVersions(a,b) {
  const lhs=versionTuple(a),rhs=versionTuple(b);
  if(!lhs||!rhs)throw new Error('VERSION_NOT_SEMVER');
  for(let i=0;i<3;i++)if(lhs[i]!==rhs[i])return Math.sign(lhs[i]-rhs[i]);
  return 0;
}
export function checkMoonlightVersions({node,npm}={}) {
  const nodeParts=versionTuple(node),npmParts=versionTuple(npm);
  const errors=[];
  if(!nodeParts || nodeParts[0]!==UPSTREAM_NODE_MAX_MAJOR || compareVersions(node,UPSTREAM_MIN_NODE)<0)
    errors.push(`UPSTREAM_NODE_REQUIRED: >=${UPSTREAM_MIN_NODE} <27.0.0; detected ${String(node)}`);
  if(!npmParts || npmParts[0]!==UPSTREAM_NPM_MAX_MAJOR || compareVersions(npm,UPSTREAM_MIN_NPM)<0)
    errors.push(`UPSTREAM_NPM_REQUIRED: >=${UPSTREAM_MIN_NPM} <12.0.0; detected ${String(npm)}`);
  return {ok:errors.length===0,errors,requirements:{node:`>=${UPSTREAM_MIN_NODE} <27.0.0`,npm:`>=${UPSTREAM_MIN_NPM} <12.0.0`}};
}

// Windows npm is exposed through a .cmd shim; execFileSync cannot run that directly.
// No user input is interpolated in this fixed command.
export function npmVersionInvocation(platform=process.platform) {
  return platform==='win32'
    ? {command:'cmd.exe',args:['/d','/s','/c','npm --version']}
    : {command:'npm',args:['--version']};
}

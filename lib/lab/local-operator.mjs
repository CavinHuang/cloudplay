// Local, single-operator M1 bridge only. NOT public production authentication.
// The installed Windows launcher MUST bind Next to 127.0.0.1 and explicitly
// enable this mode with a locally installed game; all defaults fail closed.
export function isLocalOperatorEnabled({nodeEnv=process.env.NODE_ENV,
  flag=process.env.CLOUDPLAY_LOCAL_OPERATOR_ENABLED,
  launch=process.env.CLOUDPLAY_ENABLE_LOCAL_LAUNCH,
  hostname=process.env.HOSTNAME,
  endpoint=process.env.CLOUDPLAY_LAB_ENDPOINT,
  token=process.env.CLOUDPLAY_LAB_TOKEN}={}){
  return nodeEnv==='production' && flag==='1' && launch==='1' &&
    hostname==='127.0.0.1' && endpoint==='http://127.0.0.1:7788' &&
    typeof token==='string' && token.length>=32;
}

function denied(code,status){
  return Response.json({code},{status,headers:{
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  }});
}

/** Same-origin browser protection. The server-side coordinator Bearer token
 * is never sent to a browser, logged, or accepted from user-supplied input.
 *
 * Loopback host, fixed port and explicit production startup flag protect against
 * accidental public reverse-proxy exposure; Origin + custom header prevent
 * cross-site game launches and stop requests from malicious websites.
 */
export function guardLocalOperator(request,{write=false}={}){
  if(!isLocalOperatorEnabled())return denied('LOCAL_OPERATOR_DISABLED',404);
  // Next may normalize the internal Request.url to its own server address.
  // Use the actual incoming HTTP Host header instead; only the loopback
  // Next standalone listener is allowed to enter this operator mode.
  const host=request.headers.get('host');
  if(host!=='127.0.0.1:3000')return denied('LOCAL_HOST_REQUIRED',403);
  // Reverse proxies must not be able to override the asserted local authority.
  const forwarded=request.headers.get('x-forwarded-host');
  if(forwarded && forwarded!==host)return denied('FORWARDED_HOST_REJECTED',403);
  const site=request.headers.get('sec-fetch-site');
  if(site && site!=='same-origin' && site!=='none')return denied('CROSS_ORIGIN_FORBIDDEN',403);
  if(write && (request.headers.get('origin')!=='http://127.0.0.1:3000' ||
      request.headers.get('x-cloudplay-local-action')!=='1'))
    return denied('LOCAL_ACTION_ORIGIN_REQUIRED',403);
  return null;
}

export const localNoStore={
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};

import {readLabHandoff} from '../../../../../../../lib/lab/status-client.mjs';
import {isP0UiEnabled,p0DisabledResponse} from '../../../../../../../lib/lab/ui-access.mjs';
export const dynamic='force-dynamic';
export async function GET(_request,{params}) {
  if(!isP0UiEnabled())return p0DisabledResponse();
  const {sessionId}=await params;
  const {status,...result}=await readLabHandoff(sessionId);
  if(status!==200)return Response.json({code:result.code||'STREAM_HANDOFF_UNAVAILABLE'},
    {status,headers:{'Cache-Control':'no-store'}});
  // 302 is intentionally used only for a validated loopback URL.
  return new Response(null,{status:302,headers:{Location:result.url,'Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}

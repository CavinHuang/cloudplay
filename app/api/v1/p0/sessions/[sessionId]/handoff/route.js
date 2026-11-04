import {readLabHandoff} from '../../../../../../../lib/lab/status-client.mjs';
import {isP0UiEnabled,p0DisabledResponse} from '../../../../../../../lib/lab/ui-access.mjs';
export const dynamic='force-dynamic';
export async function GET(_request,{params}) {
  if(!isP0UiEnabled())return p0DisabledResponse();
  const {sessionId}=await params;
  const {status,...body}=await readLabHandoff(sessionId);
  return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}

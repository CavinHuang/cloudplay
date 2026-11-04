import {readLabSession} from '../../../../../../lib/lab/status-client.mjs';
import {isP0UiEnabled,p0DisabledResponse} from '../../../../../../lib/lab/ui-access.mjs';
export const dynamic='force-dynamic';
export async function GET(_request,{params}) {
  if(!isP0UiEnabled())return p0DisabledResponse();
  const {sessionId}=await params;
  const response=await readLabSession(sessionId);
  const {status,...data}=response;
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

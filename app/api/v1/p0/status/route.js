import {readLabStatus} from '../../../../../lib/lab/status-client.mjs';
import {isP0UiEnabled,p0DisabledResponse} from '../../../../../lib/lab/ui-access.mjs';
export const dynamic='force-dynamic';
export async function GET(){
  if(!isP0UiEnabled())return p0DisabledResponse();
  return Response.json(await readLabStatus(),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

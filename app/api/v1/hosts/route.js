import {readLabStatus} from '../../../../lib/lab/status-client.mjs';
import {isP0UiEnabled} from '../../../../lib/lab/ui-access.mjs';
export const dynamic='force-dynamic';
export async function GET(){
  const status = isP0UiEnabled() ? await readLabStatus() : {connected:false,hosts:[],source:'disabled',message:'P0 local lab disabled'};
  return Response.json({
    data:status.hosts.map((h,i)=>({id:`lab-${i+1}`,status:h.infrastructureReady?'infra-ready':'incomplete',gpuDetected:h.gpuDetected,streamVerified:false,lastSeenAt:h.lastSeenAt})),
    meta:{count:status.hosts.length,connected:status.connected,source:status.source,message:status.message}
  },{headers:{'Cache-Control':'no-store'}});
}

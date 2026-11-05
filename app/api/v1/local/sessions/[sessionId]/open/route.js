import {guardLocalOperator,localNoStore} from '../../../../../../../lib/lab/local-operator.mjs';
import {readLabHandoff} from '../../../../../../../lib/lab/status-client.mjs';
export const dynamic='force-dynamic';
export async function GET(request,{params}){
 const denied=guardLocalOperator(request);if(denied)return denied;
 const {sessionId}=await params;
 const {status,...result}=await readLabHandoff(sessionId);
 if(status!==200)return Response.json({code:result.code||'STREAM_UNAVAILABLE'},{status,headers:localNoStore});
 // URL was validated for loopback by the server-side authenticated gateway.
 return new Response(null,{status:302,headers:{...localNoStore,Location:result.url}});
}

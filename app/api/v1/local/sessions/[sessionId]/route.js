import {guardLocalOperator,localNoStore} from '../../../../../../lib/lab/local-operator.mjs';
import {readLabSession} from '../../../../../../lib/lab/status-client.mjs';
import {stopLocalLabSession} from '../../../../../../lib/lab/local-session-gateway.mjs';
export const dynamic='force-dynamic';
export async function GET(request,{params}){
 const denied=guardLocalOperator(request);if(denied)return denied;
 const {sessionId}=await params;
 const {status,...result}=await readLabSession(sessionId);
 return Response.json(result,{status,headers:localNoStore});
}
export async function DELETE(request,{params}){
 const denied=guardLocalOperator(request,{write:true});if(denied)return denied;
 const {sessionId}=await params;
 const {status,...result}=await stopLocalLabSession(sessionId);
 return Response.json(result,{status,headers:localNoStore});
}

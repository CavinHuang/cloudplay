import {guardLocalOperator,localNoStore} from '../../../../../lib/lab/local-operator.mjs';
import {readLabStatus} from '../../../../../lib/lab/status-client.mjs';
export const dynamic='force-dynamic';
export async function GET(request){
 const denied=guardLocalOperator(request);if(denied)return denied;
 return Response.json(await readLabStatus(),{headers:localNoStore});
}

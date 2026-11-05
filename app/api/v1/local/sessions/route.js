import {guardLocalOperator,localNoStore} from '../../../../../lib/lab/local-operator.mjs';
import {createLocalLabSession} from '../../../../../lib/lab/local-session-gateway.mjs';
export const dynamic='force-dynamic';
export async function POST(request){
 const denied=guardLocalOperator(request,{write:true});if(denied)return denied;
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
   return Response.json({code:'JSON_REQUIRED'},{status:415,headers:localNoStore});
 let body;
 try{body=await request.json()}catch{return Response.json({code:'INVALID_JSON'},{status:400,headers:localNoStore});}
 if(!body || Object.keys(body).length!==1 || body.gameId!=='supertuxkart')
   return Response.json({code:'GAME_NOT_ALLOWLISTED'},{status:422,headers:localNoStore});
 const {status,...result}=await createLocalLabSession({gameId:body.gameId});
 return Response.json(result,{status,headers:localNoStore});
}

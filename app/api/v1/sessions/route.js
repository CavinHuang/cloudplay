// In P1 this endpoint is intentionally fail-closed. No GPU allocator, no auth, no license verifier.
export const dynamic='force-dynamic';
export async function GET(){return Response.json({data:[],meta:{active:0,provider:'not-configured'}},{headers:{'Cache-Control':'no-store'}})}
export async function POST(request){
 const mime=request.headers.get('content-type')||'';
 if(!mime.includes('application/json'))return Response.json({code:'CONTENT_TYPE_REQUIRED'},{status:415});
 let body;try{body=await request.json()}catch{return Response.json({code:'INVALID_JSON'},{status:400})}
 if(!body || typeof body.gameId!=='string' || body.gameId.length>128)return Response.json({code:'INVALID_GAME_ID'},{status:400});
 return Response.json({code:'SESSION_PROVIDER_NOT_CONFIGURED',message:'未连接用户认证、托管授权检查、GPU 调度器和真正的串流服务。本阶段禁止创建假会话。',gameId:body.gameId},{status:503,headers:{'Cache-Control':'no-store'}});
}

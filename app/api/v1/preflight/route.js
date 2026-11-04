import {preflight} from '@/lib/preflight.mjs';
export const dynamic='force-dynamic';
export async function GET(request){const gameId=new URL(request.url).searchParams.get('gameId');if(!gameId)return Response.json({code:'GAME_ID_REQUIRED'},{status:400});const result=preflight(gameId);return Response.json(result,{status:result.code==='GAME_NOT_FOUND'?404:200,headers:{'Cache-Control':'no-store'}})}

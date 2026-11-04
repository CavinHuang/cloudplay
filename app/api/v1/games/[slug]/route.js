import {getGame,publicGame} from '@/lib/catalog.mjs';
export async function GET(_request,{params}){const {slug}=await params;const game=getGame(slug);return game?Response.json({data:publicGame(game)}):Response.json({code:'GAME_NOT_FOUND'},{status:404})}

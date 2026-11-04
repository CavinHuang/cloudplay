import {listGames} from '@/lib/catalog.mjs';
export const dynamic='force-dynamic';
export async function GET(request){
 const params=new URL(request.url).searchParams;
 const data=listGames({query:params.get('q')||'',free:params.get('free')==='true',controller:params.get('controller')==='true',platform:params.get('platform')||'all',genre:params.get('genre')||'all',sort:params.get('sort')||'popular',collection:params.get('collection')||'all'});
 return Response.json({data,meta:{count:data.length,realPlayable:0,source:'design-and-candidate-catalog'}},{headers:{'Cache-Control':'no-store'}});
}

// Demo catalog: commercial titles and their art are VISUAL REFERENCES ONLY.
// The four open-source candidates also require rights/asset review before public hosting.
const commercial = [
  ['where','Where Winds Meet','where_winds_meet','steam','RPG',true,true],
  ['fortnite','Fortnite','fortnite','epic','Action',true,true],
  ['stalker','S.T.A.L.K.E.R. 2','stalker_2','steam','FPS',false,true],
  ['kingdom','Kingdom Come: Deliverance II','kingdom_come','steam','RPG',false,true],
  ['ready','Ready or Not','ready_or_not','steam','FPS',false,true],
  ['league','League of Legends','league_of_legends','riot','MOBA',true,false],
  ['outer','The Outer Worlds 2','outer_worlds_2','xbox','RPG',false,true],
  ['cod','Call of Duty: Modern Warfare','call_of_duty','xbox','FPS',false,true],
  ['rocket','Rocket League','rocket_league','epic','Racing',true,true],
  ['dispatch','Dispatch','dispatch','steam','Adventure',false,true],
  ['diablo','Diablo IV','diablo','xbox','RPG',false,true],
  ['motogp','MotoGP 24','motogp24','steam','Racing',false,true],
  ['ride','RIDE 4','ride4','steam','Racing',false,true],
  ['helldivers','HELLDIVERS 2','helldivers2','steam','Action',false,true],
  ['riders','Riders Republic','riders_republic','steam','Sports',false,true],
  ['silksong','Hollow Knight: Silksong','silksong','steam','Action',false,true],
  ['disco','Disco Elysium','disco_elysium','steam','RPG',false,false],
  ['powerwash','PowerWash Simulator 2','powerwash2','steam','Simulation',false,true],
  ['wukong','Black Myth: Wukong','black_myth_wukong','steam','Action',false,true],
  ['tomb','Rise of the Tomb Raider','tomb_raider','steam','Action',false,true],
  ['ready2','Ready or Not (variant)','ready_or_not_2','steam','FPS',false,true]
];
const demo = commercial.map(([id,title,img,platform,genre,isFree,controller],index) => ({
  id,slug:id,title,coverUrl:`/covers/demo/${img}.webp`,platform,genre,isFree,controller,
  sortOrder:index,collection:'showcase',hostingRights:'unverified',nodeInstalled:false,
  playable:false,description:`${title} 的界面设计示例。平台未取得或核实该游戏的云端托管授权，不能在此启动。`
}));
const candidate = [
  ['supertuxkart','SuperTuxKart','Racing',true,'https://supertuxkart.net/Download'],
  ['xonotic','Xonotic','FPS',false,'https://xonotic.org/download/'],
  ['0ad','0 A.D.','Strategy',false,'https://play0ad.com/'],
  ['veloren','Veloren','RPG',true,'https://veloren.net/']
].map(([slug,title,genre,controller,officialUrl],index)=>({
  id:slug,slug,title,coverUrl:`/covers/opensource/${slug}.svg`,platform:'native',genre,isFree:true,controller,
  sortOrder:100+index,collection:'candidate',hostingRights:'pending-review',nodeInstalled:false,
  playable:false,officialUrl,description:`${title} 是第一批官方资源接入候选。尚未完成游戏包素材授权审核、云节点安装及真实串流验收。`
}));
export const games = [...demo,...candidate];
export const publicGame = ({sortOrder,...game})=>game;
export function getGame(slug) { return games.find(g=>g.slug===slug) || null; }
export function listGames({query='',free=false,controller=false,platform='all',genre='all',collection='all',sort='popular'}={}) {
  const term=String(query).trim().toLocaleLowerCase();
  const validSort=['popular','title','recent'].includes(sort)?sort:'popular';
  let results=games.filter(g => (!term||g.title.toLocaleLowerCase().includes(term))
    &&(!free||g.isFree) &&(!controller||g.controller)
    &&(platform==='all'||g.platform===platform)
    &&(genre==='all'||g.genre===genre)
    &&(collection==='all'||g.collection===collection));
  results.sort((a,b)=> validSort==='title'?a.title.localeCompare(b.title):validSort==='recent'?b.sortOrder-a.sortOrder:a.sortOrder-b.sortOrder);
  return results.map(publicGame);
}

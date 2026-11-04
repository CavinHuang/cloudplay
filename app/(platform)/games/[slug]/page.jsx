import {notFound} from 'next/navigation';
import GameDetail from '@/components/GameDetail';
import {getGame} from '@/lib/catalog.mjs';
import {isP0UiEnabled} from '@/lib/lab/ui-access.mjs';
export default async function GamePage({params}){const {slug}=await params;const game=getGame(slug);if(!game)notFound();return <GameDetail game={game} p0LocalLab={isP0UiEnabled()&&game.id==='supertuxkart'}/>}

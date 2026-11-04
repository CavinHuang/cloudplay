import {notFound} from 'next/navigation';
import {isP0UiEnabled} from '../../../lib/lab/ui-access.mjs';
import PlayerView from '@/components/PlayerView';
export default async function Player({params}){
  const {sessionId}=await params;
  if(sessionId.startsWith('p0-')&&!isP0UiEnabled())notFound();
  return <PlayerView sessionId={sessionId}/>;
}

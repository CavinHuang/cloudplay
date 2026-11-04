export const TRANSITIONS=Object.freeze({
  requested:['allocating','cancelled','failed'],
  allocating:['starting','cancelled','failed'],
  starting:['connecting','cancelled','failed'],
  connecting:['streaming','reconnecting','stopping','failed'],
  streaming:['reconnecting','stopping','failed'],
  reconnecting:['streaming','stopping','failed'],
  stopping:['finished','failed'],
  finished:[],cancelled:[],failed:[]
});
export function transition(session, next, at=new Date().toISOString()) {
  if(!TRANSITIONS[session.state]?.includes(next)) throw new Error(`Invalid session transition: ${session.state} -> ${next}`);
  return {...session,state:next,updatedAt:at,events:[...(session.events||[]),{from:session.state,to:next,at}]};
}
export function createSessionRequest(gameId, userId='local-test-user') {
  return {id:crypto.randomUUID(),gameId,userId,state:'requested',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),events:[]};
}

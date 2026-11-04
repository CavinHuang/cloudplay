export const dynamic='force-dynamic';
export async function GET(){return Response.json({status:'ok',web:'ready',catalog:'ready',gpu:'not_connected',stream:'not_connected',auth:'not_configured',sessions:'not_configured',time:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}})}

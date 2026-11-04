/**
 * P0 is a localhost-only engineering lab. Never expose its host/session details
 * from a public Next.js deployment, even when someone copies .env.local into it.
 * P0 UI access requires both a non-production runtime and an explicit opt-in.
 */
export function isP0UiEnabled({nodeEnv=process.env.NODE_ENV,flag=process.env.CLOUDPLAY_P0_UI_ENABLED}={}) {
  return nodeEnv !== 'production' && flag === '1';
}

export function p0DisabledResponse() {
  return Response.json({code:'P0_LOCAL_LAB_DISABLED',message:'P0 local lab is not available in this environment.'},
    {status:404,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

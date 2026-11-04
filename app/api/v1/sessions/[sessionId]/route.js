export async function GET(){return Response.json({code:'SESSION_NOT_FOUND'},{status:404})}
export async function DELETE(){return Response.json({code:'SESSION_PROVIDER_NOT_CONFIGURED'},{status:503})}

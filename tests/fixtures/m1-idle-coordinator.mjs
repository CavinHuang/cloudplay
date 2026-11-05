// CI-only loopback fake of the P0 controller for the *negative idle stop* case.
// No GPU, game, or authenticated player is simulated. Never shipped in releases.
import http from 'node:http';
const token=process.env.CLOUDPLAY_IDLE_STOP_TEST_TOKEN;
if(!token||token.length<32)throw Error('TEST_TOKEN_REQUIRED');
const reply=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
http.createServer((req,res)=>{
 if(req.headers.host!=='127.0.0.1:7788')return reply(res,403,{code:'BAD_HOST'});
 if(req.url==='/health')return reply(res,200,{ok:true});
 if(req.headers.authorization!=='Bearer '+token)return reply(res,401,{code:'UNAUTHORIZED'});
 if(req.url==='/internal/lab/sessions'&&req.method==='GET')return reply(res,200,{sessions:[]});
 if(req.url==='/internal/status'&&req.method==='GET')return reply(res,200,{sessions:[],hosts:[{activeGame:null}]});
 return reply(res,404,{code:'NOT_FOUND'});
}).listen(7788,'127.0.0.1');

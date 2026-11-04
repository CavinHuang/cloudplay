import {createCoordinator} from '../lib/lab/coordinator.mjs';

const token = process.env.CLOUDPLAY_LAB_TOKEN;
if (!token || token.length < 32) {
  console.error('Missing CLOUDPLAY_LAB_TOKEN (minimum 32 characters). See docs/P0-LAB-RUNBOOK.md.');
  process.exit(1);
}
const port = Number(process.env.CLOUDPLAY_LAB_PORT || 7788);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid CLOUDPLAY_LAB_PORT');
const launchEnabled=process.env.CLOUDPLAY_ENABLE_LOCAL_LAUNCH==='1';
const {server} = createCoordinator({token,launchEnabled,streamUrl:process.env.P0_STREAM_URL||'http://127.0.0.1:8080/',journalPath:process.env.P0_SESSION_JOURNAL||null});
// P0 deliberately binds loopback; do not expose unauthenticated tools or diagnostic ports to the network.
server.listen(port, '127.0.0.1', () => console.log(`P0 coordinator ready at http://127.0.0.1:${port} (loopback only; localLaunch=${launchEnabled}; stream NOT verified)`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

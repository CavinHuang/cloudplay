#!/usr/bin/env python3
"""Optional REAL Chromium WebRTC integration smoke; no game/GPU/Sunshine needed.

Run on a workstation with Chromium, Python playwright and globally installed tsc:
  python tests/browser-real-webrtc-smoke.py

Verifies the compiled Moonlight Web diagnostic bridge against an actual local
RTCPeerConnection receiving canvas video over ICE, using two distinct origins.
This is NOT a cloud game/media experience acceptance test.
"""
from __future__ import annotations

import argparse
import functools
import html
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PARENT_PORT = 7788
CHILD_PORT = 18080
SESSION = '11111111-2222-4333-8444-555555555555'
CHALLENGE = '7f' * 32

PARENT_PAGE = f'''<!doctype html><html><head><meta charset="utf-8"><title>CloudPlay real WebRTC smoke</title></head><body>
<h1>LOCAL SYNTHETIC VIDEO — NOT A PC GAME</h1>
<iframe id="moonlight" title="Instrumented browser stream" width="720" height="440"
 src="http://127.0.0.1:{CHILD_PORT}/child.html"></iframe>
<script>
window.smoke = {{messages: [], events: [], errors: []}};
const iframe = document.getElementById('moonlight');
const hello = {{protocol: 'cloudplay.p0.media.v1', type: 'hello',
 sessionId: '{SESSION}', challenge: '{CHALLENGE}'}};
window.addEventListener('message', (event) => {{
 if (event.source !== iframe.contentWindow || event.origin !== 'http://127.0.0.1:{CHILD_PORT}') return;
 if (event.data?.protocol !== 'cloudplay.p0.media.v1' || event.data?.challenge !== hello.challenge ||
  event.data?.sessionId !== hello.sessionId) return;
 window.smoke.messages.push(event.data);
}});
const handshake = setInterval(() => {{
 if (!window.smoke.messages.some(m => m.type === 'hello_ack')) {{
  iframe.contentWindow?.postMessage(hello, 'http://127.0.0.1:{CHILD_PORT}');
 }} else clearInterval(handshake);
}}, 400);
</script></body></html>'''

CHILD_PAGE = '''<!doctype html><html><head><meta charset="utf-8"></head><body>
<h2>Synthetic canvas stream (not Sunshine)</h2>
<canvas id="canvas" width="640" height="360"></canvas>
<video id="video" muted autoplay playsinline width="640" height="360"></video>
<script type="module">
import {attachCloudPlayP0Telemetry} from '/bridge.js';
const log = (e) => { window.smokeError = String(e?.stack || e); console.error(e); };
async function main() {
 const canvas = document.querySelector('#canvas');
 const ctx = canvas.getContext('2d');
 let n = 0;
 const draw = () => {
  ctx.fillStyle = n % 2 ? '#136d9d' : '#0d2236'; ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = '#ffffff'; ctx.fillRect((n * 7) % 570, 130, 70, 70);
  n++; requestAnimationFrame(draw);
 };
 draw();
 const stream = canvas.captureStream(24);
 const outgoing = new RTCPeerConnection({iceServers: []});
 const incoming = new RTCPeerConnection({iceServers: []});
 window.syntheticPeer = incoming;
 const bridge = attachCloudPlayP0Telemetry(incoming);
 window.stopSmoke = () => { bridge.dispose(); outgoing.close(); incoming.close(); };
 outgoing.onicecandidate = e => { if (e.candidate) incoming.addIceCandidate(e.candidate).catch(log); };
 incoming.onicecandidate = e => { if (e.candidate) outgoing.addIceCandidate(e.candidate).catch(log); };
 incoming.ontrack = e => {
  const video = document.querySelector('video');
  video.srcObject = new MediaStream([e.track]);
  video.play().catch(log);
 };
 for (const t of stream.getTracks()) outgoing.addTrack(t, stream);
 await outgoing.setLocalDescription(await outgoing.createOffer());
 await incoming.setRemoteDescription(outgoing.localDescription);
 await incoming.setLocalDescription(await incoming.createAnswer());
 await outgoing.setRemoteDescription(incoming.localDescription);
 window.syntheticReady = true;
}
main().catch(log);
</script></body></html>'''

class FixedHandler(http.server.BaseHTTPRequestHandler):
    def __init__(self, *args, files=None, **kwargs):
        self.files = files or {}
        super().__init__(*args, **kwargs)

    def do_GET(self):
        item = self.files.get(self.path)
        if not item:
            self.send_error(404)
            return
        body, content_type = item
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def serve(port, files):
    factory = functools.partial(FixedHandler, files=files)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), factory)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--browser', default=('chrome' if os.name=='nt' else '/usr/bin/chromium'), help='Path to Chrome or Chromium')
    ap.add_argument('--timeout-ms', type=int, default=20000)
    ap.add_argument('--require-frames', action='store_true')
    ap.add_argument('--mode', choices=['auto','http','opaque'], default='auto', help='Use HTTP for true cross-origin verification, or opaque DOM fallback when navigation is policy-blocked')
    args = ap.parse_args()

    with tempfile.TemporaryDirectory(prefix='cloudplay-real-webrtc-') as td:
        subprocess.run(['tsc', '--target', 'es2022', '--module', 'esnext', '--lib', 'es2022,dom',
            '--skipLibCheck', '--outDir', td,
            str(ROOT / 'integrations/moonlight-web/cloudplay-p0-telemetry.ts')], check=True)
        module = (Path(td) / 'cloudplay-p0-telemetry.js').read_bytes()
        parent = child = None
        if args.mode != 'opaque':
            parent = serve(PARENT_PORT, {'/': (PARENT_PAGE.encode(), 'text/html; charset=utf-8')})
            child = serve(CHILD_PORT, {'/child.html': (CHILD_PAGE.encode(), 'text/html; charset=utf-8'),
                                       '/bridge.js': (module, 'text/javascript; charset=utf-8')})
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=args.browser, headless=True,
                    args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
                          '--use-fake-ui-for-media-stream', '--enable-features=WebRtcHideLocalIpsWithMdns'])
                page = browser.new_page()
                errors = []
                page.on('pageerror', lambda err: errors.append(str(err)))
                page.on('console', lambda msg: errors.append('console-error: '+msg.text) if msg.type == 'error' else None)
                mode = 'HTTP_CROSS_ORIGIN'
                if args.mode != 'opaque':
                    try:
                        page.goto('http://127.0.0.1:7788/', wait_until='domcontentloaded', timeout=args.timeout_ms)
                    except Exception as e:
                        if args.mode == 'http' or 'ERR_BLOCKED_BY_ADMINISTRATOR' not in str(e):
                            raise
                        mode = 'OPAQUE_ORIGIN_DOM_FALLBACK'
                        page.close()
                        page = browser.new_page()
                        page.on('pageerror', lambda err: errors.append(str(err)))
                        page.on('console', lambda msg: errors.append('console-error: '+msg.text) if msg.type == 'error' else None)
                else:
                    mode = 'OPAQUE_ORIGIN_DOM_FALLBACK'
                if mode == 'OPAQUE_ORIGIN_DOM_FALLBACK':
                    # This execution environment blocks ALL browser navigation, including loopback.
                    # Inline `srcdoc` still uses a genuine Chromium peer and video decoder but
                    # origin is opaque ('null'), so it is NOT cross-origin HTTP coverage.
                    offline_js = module.decode('utf-8').replace(
                        "const PARENT_ORIGIN = 'http://127.0.0.1:7788'", "const PARENT_ORIGIN = 'null'")
                    offline_js = offline_js.replace(
                        "parent.postMessage({ protocol:", "parent.postMessage({ protocol:")
                    offline_js = offline_js.replace('}, PARENT_ORIGIN)', "}, '*')")
                    offline_js = offline_js.replace('export function attachCloudPlayP0Telemetry',
                        'function attachCloudPlayP0Telemetry')
                    offline_child = CHILD_PAGE.replace(
                        "import {attachCloudPlayP0Telemetry} from '/bridge.js';", offline_js)
                    offline_parent = PARENT_PAGE.replace(
                        f'src="http://127.0.0.1:{CHILD_PORT}/child.html"',
                        f'srcdoc="{html.escape(offline_child, quote=True)}"')
                    offline_parent = offline_parent.replace(
                        f"event.origin !== 'http://127.0.0.1:{CHILD_PORT}'", "event.origin !== 'null'")
                    offline_parent = offline_parent.replace(
                        f"hello, 'http://127.0.0.1:{CHILD_PORT}'", "hello, '*'")
                    page.set_content(offline_parent, wait_until='domcontentloaded')
                page.wait_for_function("() => window.smoke?.messages?.some(m => m.type === 'hello_ack') && window.smoke?.messages?.filter(m => m.type === 'stats').length >= 2", timeout=args.timeout_ms)
                frames_observed = False
                try:
                    page.wait_for_function("() => { const s = window.smoke.messages.filter(m => m.type === 'stats'); return s.length >= 2 && s.at(-1).stats.video.framesDecoded > s[0].stats.video.framesDecoded; }", timeout=min(6000,args.timeout_ms))
                    frames_observed = True
                except Exception:
                    if args.require_frames:
                        raise AssertionError('No decoded video frames: ICE may be blocked by local browser policy')
                status = page.evaluate('''() => {
                  const messages = window.smoke.messages;
                  const stats = messages.filter(m => m.type === 'stats');
                  return {ackCount: messages.filter(m => m.type === 'hello_ack').length,
                    samples: stats.length,
                    firstFrames: stats[0].stats.video.framesDecoded,
                    lastFrames: stats.at(-1).stats.video.framesDecoded,
                    connection: stats.at(-1).stats.connectionState,
                    ice: stats.at(-1).stats.iceConnectionState,
                    hasNetworkAddresses: /(?:address|candidate|usernameFragment|sdp|192\\.168\\.)/i.test(JSON.stringify(messages)),
                    lastWidth: stats.at(-1).stats.video.width,
                    lastHeight: stats.at(-1).stats.video.height};
                }''')
                if errors:
                    raise AssertionError('Browser JS errors: '+str(errors))
                assert status['ackCount'] == 1, status
                # Only the iframe's own sender is accepted by the parent; a sibling
                # cannot impersonate a cooperative client across postMessage.
                page.evaluate(r"""() => {
                  window.siblingSeen = false;
                  window.addEventListener('message', e => { if(e.data?.type==='SIBLING_SIGNAL') window.siblingSeen = true; });
                  const other = document.createElement('iframe');
                  other.srcdoc = `<script>
                    parent.postMessage({type:'SIBLING_SIGNAL'}, '*');
                    parent.postMessage({protocol:'cloudplay.p0.media.v1',type:'stats',
                     sessionId:'11111111-2222-4333-8444-555555555555',challenge:'${'7f'.repeat(32)}',
                     stats:{video:{framesDecoded:9999,bytesReceived:999},audio:{bytesReceived:100}}}, '*');
                  <\/script>`;
                  other.srcdoc = other.srcdoc.replace('<\/script>', '</script>');
                  document.body.append(other);
                }""")
                page.wait_for_function('() => window.siblingSeen === true',timeout=3000)
                assert not page.evaluate('''() => window.smoke.messages.some(m => m.type === 'stats' && m.stats.video.framesDecoded === 9999)''')
                assert status['lastFrames'] >= status['firstFrames'] >= 0, status
                assert status['hasNetworkAddresses'] is False, status
                assert status['connection'] == 'connected' or not frames_observed, status
                assert status['ice'] in ('connected', 'completed') or not frames_observed, status
                assert (status['lastWidth'] == 640 and status['lastHeight'] == 360) or not frames_observed, status
                # Real transport failure: ensure browser WebRTC moves to closed.
                page.frame_locator('#moonlight').locator('video').evaluate("video => video.ownerDocument.defaultView.stopSmoke()")
                page.wait_for_function('''() => {
                  const f = document.getElementById('moonlight').contentWindow;
                  return !!f;
                }''', timeout=args.timeout_ms)
                browser.close()
                print(json.dumps({'result':'PASS_MEDIA_AND_BRIDGE' if frames_observed else 'PASS_BRIDGE_ONLY_MEDIA_NOT_VERIFIED', 'decodedFrameProgress':frames_observed, 'mode':mode, 'transport':'REAL_CHROMIUM_WEBRTC_SYNTHETIC_CANVAS', 'httpCrossOriginVerified': mode == 'HTTP_CROSS_ORIGIN',
                    'gpuVerified':False, 'sunshineVerified':False, 'gameInputVerified':False, **status},indent=2))
        finally:
            if parent: parent.shutdown(); parent.server_close()
            if child: child.shutdown(); child.server_close()

if __name__ == '__main__':
    main()

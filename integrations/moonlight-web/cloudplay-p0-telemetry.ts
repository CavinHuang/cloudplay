/**
 * CloudPlay P0-only optional instrumentation for Moonlight Web Stream.
 * Upstream integration: web/stream/transport/webrtc.ts; see docs/P0-V08-UPSTREAM-INTEGRATION.md.
 * Sends whitelisted getStats values ONLY to a local, embedding CloudPlay player
 * after a strict per-page challenge. Nothing is persisted or sent to CloudPlay API.
 * This is cooperative diagnostic data, NOT proof of visible gameplay.
 */
const PROTOCOL = 'cloudplay.p0.media.v1'
const PARENT_ORIGIN = 'http://127.0.0.1:7788'
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHALLENGE = /^[0-9a-f]{32,128}$/i

type Channel = { sessionId: string, challenge: string }
type ParentHello = { protocol?: unknown, type?: unknown, sessionId?: unknown, challenge?: unknown }
const safeCount = (x: unknown): number | null => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= 1e12 ? x : null
const safeLoss = (x: unknown): number | null => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= 1e9 ? x : null
const safeMetric = (x: unknown, max: number): number | null => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x * 100) / 100 : null
const state = (x: string): string => ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed', 'checking', 'completed'].includes(x) ? x : 'unknown'

function summarize(peer: RTCPeerConnection, report: RTCStatsReport) {
    let framesDecoded = 0, videoBytes = 0, audioBytes = 0
    let fps: number | null = null, width: number | null = null, height: number | null = null
    let videoLoss: number | null = null, audioLoss: number | null = null
    let selectedPairId: string | null = null
    let fallbackPair: { currentRoundTripTime?: number, state?: string } | null = null
    const pairs = new Map<string, { currentRoundTripTime?: number, state?: string }>()
    report.forEach((item: any) => {
        if (item.type === 'transport' && typeof item.selectedCandidatePairId === 'string') selectedPairId = item.selectedCandidatePairId
        if (item.type === 'candidate-pair') {
            pairs.set(item.id, item)
            if (item.selected === true && item.state === 'succeeded') fallbackPair = item
        }
        if (item.type !== 'inbound-rtp' || item.isRemote === true) return
        const kind = item.kind || item.mediaType
        if (kind === 'video') {
            framesDecoded += safeCount(item.framesDecoded) ?? 0
            videoBytes += safeCount(item.bytesReceived) ?? 0
            if (item.framesPerSecond !== undefined) fps = safeMetric(item.framesPerSecond, 240)
            if (item.frameWidth !== undefined) width = safeCount(item.frameWidth)
            if (item.frameHeight !== undefined) height = safeCount(item.frameHeight)
            if (item.packetsLost !== undefined) videoLoss = (videoLoss ?? 0) + (safeLoss(item.packetsLost) ?? 0)
        } else if (kind === 'audio') {
            audioBytes += safeCount(item.bytesReceived) ?? 0
            if (item.packetsLost !== undefined) audioLoss = (audioLoss ?? 0) + (safeLoss(item.packetsLost) ?? 0)
        }
    })
    const pair = selectedPairId ? pairs.get(selectedPairId) : fallbackPair
    const rtt = pair && pair.state === 'succeeded' && typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime : null
    return {
        connectionState: state(peer.connectionState), iceConnectionState: state(peer.iceConnectionState),
        video: { framesDecoded, bytesReceived: videoBytes, framesPerSecond: fps,
            width: width != null && width <= 16384 ? width : null,
            height: height != null && height <= 16384 ? height : null,
            packetsLost: videoLoss },
        audio: { bytesReceived: audioBytes, packetsLost: audioLoss },
        network: { roundTripTimeMs: rtt == null ? null : safeMetric(rtt * 1000, 60000) },
    }
}

/** Mount inside the actual transport constructor, not in the CloudPlay iframe. */
export function attachCloudPlayP0Telemetry(peer: RTCPeerConnection): { dispose(): void } {
    // Never instrument a normal (non-embedded) Moonlight session.
    if (typeof window === 'undefined' || window.parent === window) return { dispose() {} }
    const parent = window.parent
    let channel: Channel | null = null
    let interval: number | null = null
    let inFlight = false, disposed = false
    const send = (type: string, stats?: ReturnType<typeof summarize>) => {
        if (!channel || disposed) return
        parent.postMessage({ protocol: PROTOCOL, sessionId: channel.sessionId,
            challenge: channel.challenge, type, ...(stats ? { stats } : {}) }, PARENT_ORIGIN)
    }
    async function sample() {
        if (!channel || disposed || inFlight || peer.connectionState === 'closed') return
        inFlight = true
        try { send('stats', summarize(peer, await peer.getStats())) }
        catch { /* closed or renegotiating stream; do not interfere with Moonlight */ }
        finally { inFlight = false }
    }
    const onMessage = (event: MessageEvent<ParentHello>) => {
        if (disposed || event.source !== parent || event.origin !== PARENT_ORIGIN) return
        const data = event.data
        if (!data || data.protocol !== PROTOCOL || data.type !== 'hello' ||
            typeof data.sessionId !== 'string' || !SESSION_ID.test(data.sessionId) ||
            typeof data.challenge !== 'string' || !CHALLENGE.test(data.challenge)) return
        channel = { sessionId: data.sessionId, challenge: data.challenge }
        send('hello_ack')
        if (interval === null) interval = window.setInterval(() => { void sample() }, 1500)
        void sample()
    }
    window.addEventListener('message', onMessage)
    return { dispose() {
        if (disposed) return
        disposed = true
        window.removeEventListener('message', onMessage)
        if (interval !== null) window.clearInterval(interval)
        channel = null; interval = null
    } }
}

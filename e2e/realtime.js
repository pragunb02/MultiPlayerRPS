/**
 * How often the server has accepted a browser's realtime connection: Socket.IO's "connected" packet, `40{…}`, among
 * the frames it received. A refused connection (`44`), a push (`42`) and the transport's own open (`0`) do not
 * count. A push only reaches a page that is connected, so a test that sends one to a page it just opened waits for
 * this to go up first (CC-339).
 *
 * @param {ReadonlyArray<string>} frames  the frames a browser received, in order (`record.socketFrames`)
 * @returns {number}
 */
export const realtimeConnects = (frames) => frames.filter((frame) => frame.startsWith("40{")).length;

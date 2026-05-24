/**
 * typing.ts — typing indicator broadcast.
 *
 * A typing event is broadcast to all other members of the current channel
 * immediately on the first keystroke and debounced so that the `"typing:stopped"`
 * event is only emitted after 4 seconds of inactivity (receiving WS messages with
 * typing:pong is still required).
 */
const TYPING_DEBOUNCE_MS = 4_000; // 4 s silent → emit stopped
const typingTimers = new Map();
/**
 * onTyping — called by the WS message handler or REST proxy when the client
 * signals they have started typing in a chat.
 *
 * @param channelId  UUID of the channel.
 * @param identityId UUID of the identity doing the typing.
 */
export function onTyping(channelId, identityId) {
    const key = `${channelId}:${identityId}`;
    // Reset the stop timer to produce "typing:stopped" after 3 seconds of silence.
    const existing = typingTimers.get(key);
    if (existing)
        clearTimeout(existing);
    typingTimers.set(key, setTimeout(() => {
        typingTimers.delete(key);
        // TODO: Not implemented — broadcast WS event `"typing:stopped"`.
        console.log(`[typing] ${identityId} stopped in ${channelId}`);
    }, TYPING_DEBOUNCE_MS));
    // TODO: Not implemented — broadcast WS event `"typing:started"`.
    console.log(`[typing] ${identityId} started in ${channelId}`);
}
/**
 * clearTyping — cancel the debounce timer for the given channel + identity pair.
 * Called when the input loses focus or the client navigates away.
 */
export function clearTyping(channelId, identityId) {
    const key = `${channelId}:${identityId}`;
    const timer = typingTimers.get(key);
    if (timer) {
        clearTimeout(timer);
        typingTimers.delete(key);
    }
}
//# sourceMappingURL=typing.js.map
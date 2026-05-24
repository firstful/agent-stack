/**
 * typing.ts — typing indicator broadcast.
 *
 * A typing event is broadcast to all other members of the current channel
 * immediately on the first keystroke and debounced so that the `"typing:stopped"`
 * event is only emitted after 4 seconds of inactivity (receiving WS messages with
 * typing:pong is still required).
 */
/**
 * onTyping — called by the WS message handler or REST proxy when the client
 * signals they have started typing in a chat.
 *
 * @param channelId  UUID of the channel.
 * @param identityId UUID of the identity doing the typing.
 */
export declare function onTyping(channelId: string, identityId: string): void;
/**
 * clearTyping — cancel the debounce timer for the given channel + identity pair.
 * Called when the input loses focus or the client navigates away.
 */
export declare function clearTyping(channelId: string, identityId: string): void;
//# sourceMappingURL=typing.d.ts.map
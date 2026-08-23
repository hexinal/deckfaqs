// Right-trackpad scrolling for the QAM guide view. Steam's analog input
// messages carry the virtual-mouse accumulator (fed by the right trackpad
// and right stick — the two inputs Decky menu navigation ignores — and
// indistinguishable per source): a float position, y growing downward,
// emitted at ~120 Hz only while there is input and persistent across
// touches. Pad flicks keep integrating after lift, so kinetic scrolling
// comes for free. The stream is off by default and gated by
// EnableControllerAnalogInputMessages.

/** Viewports scrolled per full trackpad swipe. */
const SCROLL_SCALE = 1.5;
/** Accumulator units one full trackpad swipe covers (measured on-device). */
const UNITS_PER_SWIPE = 600;

/**
 * Follow trackpad input with `getEl()`'s scroll position (touchscreen
 * convention: finger down drags the content down). Returns the cleanup, or
 * undefined when the Steam client lacks the API — Valve shuffles these
 * between versions and the @decky/ui typings are aspirational, so a missing
 * or changed API must degrade to no trackpad scrolling, not crash the guide
 * view. The same distrust extends to the payload: a delta is applied only
 * when it is finite, plausibly swipe-sized (a reset or clamp of the
 * accumulator, or a second controller's interleaved stream, is a
 * reposition, not a swipe) and from the same source as the previous
 * message. Note the enable switch is global and refcount-free: another
 * plugin toggling it can silently stop or restart the stream under us.
 */
export const registerPadScroll = (
    getEl: () => HTMLElement | null
): (() => void) | undefined => {
    const input: typeof SteamClient.Input | undefined = SteamClient.Input;
    if (
        typeof input?.RegisterForControllerAnalogInputMessages !== 'function' ||
        typeof input.EnableControllerAnalogInputMessages !== 'function'
    )
        return undefined;
    let prevA = NaN; // identity args of the previous message
    let prevB = NaN;
    let prevY: number | null = null;
    input.EnableControllerAnalogInputMessages(true);
    let reg;
    try {
        reg = input.RegisterForControllerAnalogInputMessages(
            (a: number, b: number, _c: boolean, _x: number, y: number) => {
                const prev = prevY;
                const sameSource = a === prevA && b === prevB;
                prevA = a;
                prevB = b;
                prevY = y;
                if (prev === null || !sameSource) return; // position only
                const delta = y - prev;
                if (
                    !Number.isFinite(delta) ||
                    Math.abs(delta) > UNITS_PER_SWIPE
                )
                    return;
                const el = getEl();
                if (!el) return;
                el.scrollTop -=
                    (delta * el.clientHeight * SCROLL_SCALE) / UNITS_PER_SWIPE;
            }
        );
    } catch {
        input.EnableControllerAnalogInputMessages(false);
        return undefined;
    }
    return () => {
        try {
            reg?.unregister?.();
        } finally {
            input.EnableControllerAnalogInputMessages(false);
        }
    };
};

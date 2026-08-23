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
 * method must degrade to no trackpad scrolling, not crash the guide view.
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
    let prevY: number | null = null;
    input.EnableControllerAnalogInputMessages(true);
    const reg = input.RegisterForControllerAnalogInputMessages(
        (_a: number, _b: number, _c: boolean, _x: number, y: number) => {
            const prev = prevY;
            prevY = y;
            if (prev === null) return; // first message: position only
            const el = getEl();
            if (!el) return;
            el.scrollTop -=
                ((y - prev) * el.clientHeight * SCROLL_SCALE) / UNITS_PER_SWIPE;
        }
    );
    return () => {
        reg.unregister();
        input.EnableControllerAnalogInputMessages(false);
    };
};

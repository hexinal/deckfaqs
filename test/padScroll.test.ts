import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPadScroll } from '../src/padScroll';

// The degradation contract: a missing or hostile SteamClient.Input must mean
// "no trackpad scrolling", never a throw (a throw inside the guide's effect
// unmounts the whole view). The scroll arithmetic itself is covered by the
// smoke test against the built bundle.

afterEach(() => {
    vi.unstubAllGlobals();
});

const getEl = () => null;

describe('registerPadScroll', () => {
    it('degrades to undefined when the Input API is missing', () => {
        vi.stubGlobal('SteamClient', {});
        expect(registerPadScroll(getEl)).toBeUndefined();
    });

    it('degrades without enabling when only one method exists', () => {
        const enable = vi.fn();
        vi.stubGlobal('SteamClient', {
            Input: { EnableControllerAnalogInputMessages: enable },
        });
        expect(registerPadScroll(getEl)).toBeUndefined();
        expect(enable).not.toHaveBeenCalled();
    });

    it('disables the stream and degrades when registering throws', () => {
        const enable = vi.fn();
        vi.stubGlobal('SteamClient', {
            Input: {
                EnableControllerAnalogInputMessages: enable,
                RegisterForControllerAnalogInputMessages: () => {
                    throw new Error('changed arity');
                },
            },
        });
        expect(registerPadScroll(getEl)).toBeUndefined();
        expect(enable.mock.calls).toEqual([[true], [false]]);
    });

    it('tolerates a scroller that is not there and a broken Unregisterable', () => {
        let cb!: (
            a: number,
            b: number,
            c: boolean,
            x: number,
            y: number
        ) => void;
        vi.stubGlobal('SteamClient', {
            Input: {
                EnableControllerAnalogInputMessages: vi.fn(),
                RegisterForControllerAnalogInputMessages: (f: typeof cb) => {
                    cb = f;
                    return undefined; // no unregister at all
                },
            },
        });
        const cleanup = registerPadScroll(getEl)!;
        expect(cleanup).toBeTypeOf('function');
        // Two same-source messages with no scroll element: must not throw.
        expect(() => {
            cb(15, 47, false, 0, 100);
            cb(15, 47, false, 0, 90);
        }).not.toThrow();
        expect(cleanup).not.toThrow();
    });

    it('unregisters before disabling the stream on cleanup', () => {
        const order: string[] = [];
        vi.stubGlobal('SteamClient', {
            Input: {
                EnableControllerAnalogInputMessages: (on: boolean) => {
                    order.push(`enable:${on}`);
                },
                RegisterForControllerAnalogInputMessages: () => ({
                    unregister: () => {
                        order.push('unregister');
                    },
                }),
            },
        });
        registerPadScroll(getEl)!();
        expect(order).toEqual(['enable:true', 'unregister', 'enable:false']);
    });
});

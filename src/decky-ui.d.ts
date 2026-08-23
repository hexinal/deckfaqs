// Props and APIs that exist on the Steam client's components/router but are not
// declared in @decky/ui's typings. Augment the originating module files (the
// package re-exports them via `export *`, so augmenting '@decky/ui' itself
// would not merge). Add here instead of sprinkling @ts-expect-error.
import type { Ref } from 'react';
import type { BrowserViewPopup } from '@decky/ui/dist/globals/steam-client/browser-view/BrowserViewPopup';
import type { Unregisterable } from '@decky/ui/dist/globals/steam-client/shared';

declare module '@decky/ui/dist/components/Dialog' {
    interface DialogButtonProps {
        /** Suppress the Steam UI navigation click sound. */
        disableNavSounds?: boolean;
    }
}

declare module '@decky/ui/dist/components/Item' {
    interface ItemProps {
        disableNavSounds?: boolean;
    }
}

declare module '@decky/ui/dist/components/Dropdown' {
    interface DropdownProps {
        disableNavSounds?: boolean;
    }
}

declare module '@decky/ui/dist/components/Focusable' {
    interface FocusableProps {
        /** Make the element focusable even when it has no focusable children. */
        focusableIfNoChildren?: boolean;
    }
}

declare module '@decky/ui/dist/components/TextField' {
    interface TextFieldProps {
        placeholder?: string;
        /** The underlying Steam class component; `.element` is the DOM node. */
        ref?: Ref<{ element?: HTMLElement }>;
    }
}

// NB: the Input typings are stale in places — RegisterForControllerStateChanges
// no longer exists at runtime (probed on a real Deck, 2026-08; calling it
// crashed the guide view before commit 6245221 guarded it).
declare module '@decky/ui/dist/globals/steam-client/Input' {
    interface Input {
        /** Gates the analog input message stream; off by default. */
        EnableControllerAnalogInputMessages(enable: boolean): void;
        /**
         * Runtime signature overload (the declared array-callback form never
         * fires): x/y are Steam's accumulated virtual-mouse position, fed by
         * the right trackpad and right stick, y growing downward. Messages
         * arrive only while there is input and require
         * EnableControllerAnalogInputMessages(true). Merging this overload
         * first also makes implicit callback params contextually type as
         * number — deliberate, since the array form is dead.
         */
        RegisterForControllerAnalogInputMessages(
            callback: (
                a: number,
                b: number,
                c: boolean,
                x: number,
                y: number
            ) => void
        ): Unregisterable;
    }
}

declare module '@decky/ui/dist/modules/Router' {
    interface Router {
        NavigateToRunningApp(): void;
    }
    interface WindowRouter {
        CreateBrowserView(name: string): BrowserViewPopup;
    }
}

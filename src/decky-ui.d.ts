// Props and APIs that exist on the Steam client's components/router but are not
// declared in @decky/ui's typings. Augment the originating module files (the
// package re-exports them via `export *`, so augmenting '@decky/ui' itself
// would not merge). Add here instead of sprinkling @ts-expect-error.
import type { Ref } from 'react';
import type { BrowserViewPopup } from '@decky/ui/dist/globals/steam-client/browser-view/BrowserViewPopup';

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

declare module '@decky/ui/dist/modules/Router' {
    interface Router {
        NavigateToRunningApp(): void;
    }
    interface WindowRouter {
        CreateBrowserView(name: string): BrowserViewPopup;
    }
}

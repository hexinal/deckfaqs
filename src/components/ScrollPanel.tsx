import { ScrollPanel as DeckyScrollPanel } from '@decky/ui';
import { FC, ReactNode, HTMLAttributes, RefAttributes } from 'react';

//Unclear how many of these have an effect (also probably not exhaustive)
interface ScrollPanelProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    scrollDirection?: 'x' | 'y' | 'both';
    focusable?: boolean;
    autoFocus?: boolean;
    scrollStepPercent?: number;
    scrollBehavior?: string;
    noFocusRing?: boolean;
    onOKButton?: (e: CustomEvent) => void;
    onCancelButton?: (e: CustomEvent) => void;
}

// @decky/ui locates Steam's ScrollPanel component for us (the old hand-rolled
// findModuleChild lookup no longer matches current Steam clients). We only
// re-export it here to attach a richer prop type.
export const ScrollPanel = DeckyScrollPanel as FC<
    ScrollPanelProps & RefAttributes<HTMLDivElement>
>;

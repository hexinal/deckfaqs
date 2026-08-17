import {
    DialogButton,
    Focusable,
    GamepadButton,
    type GamepadEvent,
    ModalRoot,
    type ModalRootProps,
    Navigation,
    QuickAccessTab,
} from '@decky/ui';
import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    type WheelEvent as ReactWheelEvent,
} from 'react';

/**
 * A guide image or Neoseeker clip, as read off the guide's `<img>`.
 * `full` / `mp4` / `webm` come from the extractor's `data-*` attributes and
 * have already been checked against the source's image origins by Guide.tsx.
 */
export type GuideMedia =
    | { kind: 'image'; src: string; full?: string; alt: string; size?: string }
    | {
          kind: 'video';
          poster: string;
          mp4?: string;
          webm?: string;
          alt: string;
          size?: string;
      };

export const mediaOf = (img: HTMLImageElement): GuideMedia => {
    const { videoMp4, videoWebm, full, size, filename } = img.dataset;
    const alt = filename || img.getAttribute('alt') || '';
    if (videoMp4 || videoWebm) {
        return {
            kind: 'video',
            poster: img.getAttribute('src') ?? '',
            mp4: videoMp4,
            webm: videoWebm,
            alt,
            size,
        };
    }
    return {
        kind: 'image',
        src: img.getAttribute('src') ?? '',
        full,
        alt,
        size,
    };
};

type MediaModalProps = ModalRootProps & {
    media: GuideMedia;
    /** Opened from the Quick Access Menu: reopen it when the modal closes. */
    reopenQuickAccess?: boolean;
};

// The dialog's box; the media is capped in viewport units too, because
// percentage heights don't survive Steam's dialog wrappers.
const BOX_W = '90vw';
const BOX_H = '80vh';
const HEADER_H = 44;
const OVERFLOW_MARGIN = 8;
const MAX_SCALE = 8;
const STEP = 1.25;

const mediaStyle: CSSProperties = {
    objectFit: 'contain',
    display: 'block',
    userSelect: 'none',
};

type Pointer = { x: number; y: number };
type Zoom = { scale: number; tx: number; ty: number };

// Right trigger/bumper zoom in, left ones out; d-pad / left stick pan.
const ZOOM_IN = new Set<number>([
    GamepadButton.TRIGGER_RIGHT,
    GamepadButton.BUMPER_RIGHT,
]);
const ZOOM_OUT = new Set<number>([
    GamepadButton.TRIGGER_LEFT,
    GamepadButton.BUMPER_LEFT,
]);
const PAN_STEP = 80;
const PAN = new Map<number, Pointer>([
    [GamepadButton.DIR_UP, { x: 0, y: PAN_STEP }],
    [GamepadButton.DIR_DOWN, { x: 0, y: -PAN_STEP }],
    [GamepadButton.DIR_LEFT, { x: PAN_STEP, y: 0 }],
    [GamepadButton.DIR_RIGHT, { x: -PAN_STEP, y: 0 }],
]);

const distance = (a?: Pointer, b?: Pointer): number =>
    a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
const midpoint = (a?: Pointer, b?: Pointer): Pointer =>
    a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };

/**
 * Lightbox for guide media, portaled by Steam out of the guide (so it is
 * styled inline and dark mode's invert filter never reaches it).
 * Images: fit-to-screen; pinch / wheel / triggers zoom, drag / d-pad pans,
 * tap or A toggles fit and actual size. B / Close dismisses.
 * Clips: fit-to-screen <video> with the browser's controls.
 */
export const MediaModal = (props: MediaModalProps) => {
    const { media, reopenQuickAccess } = props;
    const [zoomed, setZoomed] = useState(false);
    // Steam's dialog is smaller than the viewport and clips or scrolls its
    // content rather than constraining it, so the box (and the media in it)
    // is sized after mount: capped at the smallest dialog ancestor, and shrunk
    // by however far it sticks out below a scrolling ancestor so the whole
    // dialog fits on screen. Shrinks only, so it settles in a pass or two.
    const boxRef = useRef<HTMLDivElement | null>(null);
    const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const measure = (checkOverflow: boolean) => {
            let width = box.offsetWidth || Infinity;
            let height = box.offsetHeight || Infinity;
            let overflowY = 0;
            let child: HTMLElement = box;
            for (
                let el = box.parentElement;
                el && el !== document.body;
                child = el, el = el.parentElement
            ) {
                if (el.clientWidth > 0) width = Math.min(width, el.clientWidth);
                if (el.clientHeight > 0) {
                    height = Math.min(height, el.clientHeight);
                }
                // The dialog grows with its content vertically (the screen
                // clips it): shrink by how far the dialog (the scrolling
                // ancestor's child on our path, i.e. box + dialog chrome)
                // sticks out below that ancestor's visible bottom — only that
                // much, so an ancestor overflowing for other reasons is left
                // alone. Horizontally the dialog is a fixed width; the min
                // above does.
                if (checkOverflow && el.scrollHeight > el.clientHeight + 1) {
                    const r = el.getBoundingClientRect();
                    const visibleBottom =
                        r.top + el.clientTop + el.clientHeight;
                    const bottom =
                        child.getBoundingClientRect().bottom +
                        (parseFloat(getComputedStyle(child).marginBottom) || 0);
                    overflowY = Math.max(overflowY, bottom - visibleBottom);
                }
            }
            if (overflowY > 0) height -= overflowY + OVERFLOW_MARGIN;
            setBoxSize((prev) => {
                const next = {
                    width: Number.isFinite(width) ? Math.max(width, 0) : 0,
                    height: Number.isFinite(height) ? Math.max(height, 0) : 0,
                };
                return next.width === prev.width && next.height === prev.height
                    ? prev
                    : next;
            });
        };
        // The overflow check reads on-screen rects, and Steam animates the
        // dialog open with a transform: run it once that has settled.
        let settled = false;
        measure(false);
        const timers = [300, 800].map((ms) =>
            setTimeout(() => {
                settled = true;
                measure(true);
            }, ms)
        );
        const observer =
            typeof ResizeObserver === 'undefined'
                ? undefined
                : new ResizeObserver(() => measure(settled));
        observer?.observe(box);
        return () => {
            timers.forEach(clearTimeout);
            observer?.disconnect();
        };
    }, []);
    const sizeCap: CSSProperties = {
        maxWidth: boxSize.width
            ? `${boxSize.width - 20}px`
            : `calc(${BOX_W} - 20px)`,
        maxHeight: boxSize.height
            ? `${boxSize.height - HEADER_H - 20}px`
            : `calc(${BOX_H} - ${HEADER_H + 20}px)`,
    };
    const [failed, setFailed] = useState(false);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const viewRef = useRef<HTMLDivElement | null>(null);
    // Gesture state lives in refs and is written straight to the element's
    // transform: a pinch fires far too often to round-trip through React.
    const zoom = useRef<Zoom>({ scale: 1, tx: 0, ty: 0 });
    const pointers = useRef(new Map<number, Pointer>());
    const gesture = useRef({ pinchDist: 0, pinchScale: 1, moved: false });

    const close = () => {
        props.closeModal?.();
        if (reopenQuickAccess) {
            Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
        }
    };

    const apply = useCallback(() => {
        const img = imgRef.current;
        const view = viewRef.current;
        if (!img || !view) return;
        const z = zoom.current;
        if (z.scale <= 1) {
            z.scale = 1;
            z.tx = 0;
            z.ty = 0;
        } else {
            // Keep the image over the viewport: centred while it fits, edges
            // pinned to the viewport's once it is larger.
            const v = view.getBoundingClientRect();
            const w = img.clientWidth * z.scale;
            const h = img.clientHeight * z.scale;
            // The image's untransformed (layout) position.
            const r = img.getBoundingClientRect();
            const l0 = r.left - z.tx;
            const t0 = r.top - z.ty;
            z.tx =
                w <= v.width
                    ? v.left + (v.width - w) / 2 - l0
                    : Math.min(v.left - l0, Math.max(v.right - l0 - w, z.tx));
            z.ty =
                h <= v.height
                    ? v.top + (v.height - h) / 2 - t0
                    : Math.min(v.top - t0, Math.max(v.bottom - t0 - h, z.ty));
        }
        img.style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.scale})`;
        setZoomed(z.scale > 1);
    }, []);

    /** Scales by `factor` keeping the point under (cx, cy) (client coords) still. */
    const zoomAt = useCallback(
        (factor: number, cx: number, cy: number) => {
            const img = imgRef.current;
            if (!img) return;
            const z = zoom.current;
            const next = Math.min(MAX_SCALE, Math.max(1, z.scale * factor));
            const ratio = next / z.scale;
            const r = img.getBoundingClientRect();
            const l0 = r.left - z.tx;
            const t0 = r.top - z.ty;
            z.tx = cx - l0 - (cx - l0 - z.tx) * ratio;
            z.ty = cy - t0 - (cy - t0 - z.ty) * ratio;
            z.scale = next;
            apply();
        },
        [apply]
    );

    const centre = (): Pointer => {
        const v = viewRef.current?.getBoundingClientRect();
        return v
            ? { x: v.left + v.width / 2, y: v.top + v.height / 2 }
            : { x: 0, y: 0 };
    };

    /** Fit ↔ actual size (or 2× when the file is smaller than the fit). */
    const toggleZoom = useCallback(
        (at?: Pointer) => {
            const img = imgRef.current;
            if (!img || media.kind !== 'image') return;
            const p = at ?? centre();
            if (zoom.current.scale > 1) {
                zoomAt(0, p.x, p.y);
                return;
            }
            const natural = img.clientWidth
                ? img.naturalWidth / img.clientWidth
                : 0;
            zoomAt(natural > 1.05 ? natural : 2, p.x, p.y);
        },
        [media.kind, zoomAt]
    );

    const panBy = (dx: number, dy: number) => {
        zoom.current.tx += dx;
        zoom.current.ty += dy;
        apply();
    };

    // --- touch / mouse ------------------------------------------------------
    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (media.kind !== 'image') return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 1) gesture.current.moved = false;
        if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current.pinchDist = distance(a, b);
            gesture.current.pinchScale = zoom.current.scale;
            gesture.current.moved = true;
        }
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const now = { x: e.clientX, y: e.clientY };
        pointers.current.set(e.pointerId, now);
        if (pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            if (gesture.current.pinchDist > 0) {
                const target =
                    (gesture.current.pinchScale * distance(a, b)) /
                    gesture.current.pinchDist;
                const m = midpoint(a, b);
                zoomAt(target / zoom.current.scale, m.x, m.y);
            }
            return;
        }
        const dx = now.x - prev.x;
        const dy = now.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) gesture.current.moved = true;
        if (zoom.current.scale > 1) panBy(dx, dy);
    };
    const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!pointers.current.delete(e.pointerId)) return;
        if (pointers.current.size === 0) {
            if (!gesture.current.moved && e.type === 'pointerup') {
                toggleZoom({ x: e.clientX, y: e.clientY });
            }
            gesture.current.pinchDist = 0;
        } else if (pointers.current.size === 1) {
            // Second finger lifted: continue as a pan from here.
            gesture.current.pinchDist = 0;
        }
    };
    const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
        if (media.kind !== 'image') return;
        zoomAt(Math.pow(STEP, -e.deltaY / 100), e.clientX, e.clientY);
    };

    // --- gamepad ------------------------------------------------------------
    const onButtonDown = (e: GamepadEvent) => {
        if (media.kind !== 'image') return;
        const c = centre();
        if (ZOOM_IN.has(e.detail.button)) zoomAt(STEP, c.x, c.y);
        else if (ZOOM_OUT.has(e.detail.button)) zoomAt(1 / STEP, c.x, c.y);
    };
    const onGamepadDirection = (e: GamepadEvent) => {
        const pan = PAN.get(e.detail.button);
        if (!pan || zoom.current.scale <= 1) return;
        panBy(pan.x, pan.y);
        e.preventDefault();
        e.stopPropagation();
    };

    const caption = [media.alt, media.size].filter(Boolean).join(' · ');
    let content;
    if (media.kind === 'video' && !failed) {
        content = (
            <video
                poster={media.poster}
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="auto"
                style={{ ...mediaStyle, ...sizeCap }}
            >
                {/* webm first: CEF always decodes VP8/VP9; H.264 depends on the build. */}
                {media.webm && (
                    <source
                        src={media.webm}
                        type="video/webm"
                        onError={media.mp4 ? undefined : () => setFailed(true)}
                    />
                )}
                {media.mp4 && (
                    <source
                        src={media.mp4}
                        type="video/mp4"
                        onError={() => setFailed(true)}
                    />
                )}
            </video>
        );
    } else {
        const src =
            media.kind === 'video' ? media.poster : (media.full ?? media.src);
        content = (
            <img
                ref={imgRef}
                src={src}
                alt={media.alt}
                draggable={false}
                style={{
                    ...mediaStyle,
                    ...sizeCap,
                    transformOrigin: '0 0',
                    cursor: media.kind === 'image' ? 'zoom-in' : undefined,
                }}
                onError={(e) => {
                    // Full-size file missing: fall back to the inline thumbnail.
                    if (media.kind === 'image' && media.full) {
                        const el = e.currentTarget;
                        if (el.src !== media.src) el.src = media.src;
                    }
                }}
            />
        );
    }

    return (
        <ModalRoot bAllowFullSize closeModal={close}>
            <div
                ref={boxRef}
                data-zoom={zoomed ? 'zoomed' : 'fit'}
                style={{
                    width: boxSize.width ? `${boxSize.width}px` : BOX_W,
                    maxWidth: BOX_W,
                    height: boxSize.height ? `${boxSize.height}px` : BOX_H,
                    maxHeight: BOX_H,
                    display: 'flex',
                    flexFlow: 'column',
                    overflow: 'hidden',
                    background: '#000',
                    color: '#ddd',
                }}
            >
                <div
                    style={{
                        height: `${HEADER_H}px`,
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '6px 10px',
                        fontSize: '13px',
                    }}
                >
                    <span
                        style={{
                            flexGrow: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {caption}
                        {media.kind === 'video' && failed
                            ? ' — this clip can’t be played here.'
                            : media.kind === 'image'
                              ? ' — pinch or triggers to zoom, tap for actual size'
                              : ''}
                    </span>
                    <DialogButton
                        disableNavSounds={true}
                        style={{
                            width: 'auto',
                            minWidth: '90px',
                            padding: '6px 12px',
                        }}
                        onClick={close}
                    >
                        Close
                    </DialogButton>
                </div>
                <Focusable
                    ref={viewRef}
                    focusableIfNoChildren={true}
                    noFocusRing={true}
                    onOKButton={() => toggleZoom()}
                    onCancelButton={close}
                    onButtonDown={onButtonDown}
                    onGamepadDirection={onGamepadDirection}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onWheel={onWheel}
                    style={{
                        flexGrow: 1,
                        minHeight: 0,
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        touchAction: 'none',
                    }}
                >
                    {content}
                </Focusable>
            </div>
        </ModalRoot>
    );
};

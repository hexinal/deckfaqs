import DOMPurify from 'dompurify';

// Guides render inside Steam's UI: HTML only (no svg/math), and nothing that
// can load or embed media on its own beyond <img src> (which Guide.tsx checks
// against the source's image hosts) — no srcset/picture/video/audio/style/forms.
const GUIDE_SANITIZE = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
        'style',
        'video',
        'audio',
        'source',
        'track',
        'picture',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'select',
        'textarea',
        'template',
    ],
    FORBID_ATTR: ['srcset', 'sizes', 'background', 'poster', 'action'],
};

/** Sanitises scraped guide markup for the viewer. */
export const sanitizeGuideHtml = (html: string): string =>
    DOMPurify.sanitize(html, GUIDE_SANITIZE);

export type HighlightTemplateElementType = 'heading' | 'subheading' | 'text' | 'richtext' | 'signature' | 'watermark' | 'stat' | 'progressbar' | 'badgecounter' | 'image' | 'icon' | 'seal' | 'border' | 'backgroundpattern' | 'divider' | 'columnlayout' | 'shape' | 'container' | 'recipientname' | 'awardtitle' | 'eventfield' | 'datefield' | 'issuerblock' | 'medal' | 'qrcode' | 'barcode' | 'html' | 'dynamicplaceholder';

export type HighlightTemplateElement = {
    id: string;
    type: HighlightTemplateElementType;
    content: string;
    subContent?: string;
    color?: string;
    background?: string;
    fontSize?: number;
    fontWeight?: '300' | '400' | '500' | '600' | '700' | '800';
    textAlign?: 'left' | 'center' | 'right';
    textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
    letterSpacing?: number;
    lineHeight?: number;
    imageFit?: 'cover' | 'contain';
    borderRadius?: number;
    width?: number;
    height?: number;
    html?: string;
    iconName?: string; // for icon element
    progress?: number; // for progress bar
    columns?: number; // for column layout
    shapeType?: 'circle' | 'rectangle' | 'ribbon' | 'banner'; // for shape element
    signatureName?: string; // for signature block
    signatureDesignation?: string; // for signature block
    watermarkOpacity?: number; // for watermark text
    qrCodeData?: string; // for QR code
    barcodeData?: string; // for barcode
    dynamicFieldType?: string; // for dynamic placeholder
};


export type HighlightTemplate = {
    id: string;
    name: string;
    description: string;
    background: string;
    overlay?: string;
    textColor: string;
    accentColor: string;
    surfaceColor?: string;
    elements: HighlightTemplateElement[];
    createdByOwner?: boolean;
};

export const createTemplateId = () => `tmpl-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
export const createElementId = () => `el-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

export const defaultHighlightTemplates: HighlightTemplate[] = [
    {
        id: 'default-neon-glow',
        name: 'Neon Glow',
        description: 'Bold gradient hero with stat spotlight and badge parade.',
        background: 'linear-gradient(135deg, rgba(244,114,182,0.9), rgba(59,130,246,0.85))',
        overlay: 'rgba(15,23,42,0.45)',
        textColor: '#ffffff',
        accentColor: '#fcd34d',
        elements: [
            {
                id: createElementId(),
                type: 'heading',
                content: 'Level {{level}} Unlocked',
                fontSize: 36,
                fontWeight: '700',
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: 2,
            },
            {
                id: createElementId(),
                type: 'subheading',
                content: 'Total XP: {{xp}}',
                fontSize: 20,
                fontWeight: '600',
                textAlign: 'center',
            },
            {
                id: createElementId(),
                type: 'text',
                content: 'Badges earned: {{badges}} | Current streak: {{streak}} days',
                fontSize: 16,
                fontWeight: '500',
                textAlign: 'center',
            },
            {
                id: createElementId(),
                type: 'stat',
                content: '{{rank}}',
                subContent: 'Global Rank',
                fontSize: 18,
                fontWeight: '600',
                textAlign: 'center',
                background: 'rgba(15,23,42,0.35)',
                borderRadius: 16,
            },
        ],
    },
    {
        id: 'default-aurora-card',
        name: 'Aurora Card',
        description: 'Frosted card with clean stat blocks and subtle glow.',
        background: '#0f172a',
        overlay: 'linear-gradient(145deg, rgba(56,189,248,0.2), rgba(168,85,247,0.25))',
        textColor: '#ecfeff',
        accentColor: '#38bdf8',
        surfaceColor: 'rgba(15,23,42,0.65)',
        elements: [
            {
                id: createElementId(),
                type: 'heading',
                content: '{{name}} just pushed higher',
                fontSize: 30,
                fontWeight: '700',
                textAlign: 'left',
            },
            {
                id: createElementId(),
                type: 'text',
                content: 'Level {{level}} - {{xp}} XP - {{badges}} badges',
                fontSize: 18,
                fontWeight: '500',
            },
            {
                id: createElementId(),
                type: 'text',
                content: 'Streak blazing at {{streak}} days in Zea.Play',
                fontSize: 16,
                fontWeight: '400',
            },
            {
                id: createElementId(),
                type: 'stat',
                content: '#{{rank}}',
                subContent: 'Global position',
                fontSize: 18,
                fontWeight: '600',
                background: 'rgba(59,130,246,0.25)',
                borderRadius: 20,
            },
        ],
    },
    {
        id: 'default-minimal',
        name: 'Minimal Focus',
        description: 'Simple monochrome layout with accent underline.',
        background: '#ffffff',
        textColor: '#0f172a',
        accentColor: '#6366f1',
        elements: [
            {
                id: createElementId(),
                type: 'heading',
                content: '{{name}} is crushing it at level {{level}}',
                fontSize: 32,
                fontWeight: '700',
                textAlign: 'left',
            },
            {
                id: createElementId(),
                type: 'text',
                content: '{{xp}} XP total - {{badges}} badges unlocked',
                fontSize: 18,
                fontWeight: '500',
                textAlign: 'left',
            },
            {
                id: createElementId(),
                type: 'text',
                content: 'Current streak: {{streak}} days',
                fontSize: 16,
                fontWeight: '400',
                textAlign: 'left',
            },
            {
                id: createElementId(),
                type: 'stat',
                content: '#{{rank}} global',
                subContent: 'Leaderboard',
                fontSize: 18,
                fontWeight: '600',
                textAlign: 'left',
                background: 'rgba(99,102,241,0.12)',
                borderRadius: 12,
            },
        ],
    },
    {
        id: 'default-solar',
        name: 'Solar Burst',
        description: 'High-energy radial gradient with centered stats.',
        background: 'radial-gradient(circle at top, rgba(251,191,36,0.75), rgba(168,85,247,0.85))',
        overlay: 'rgba(15,23,42,0.3)',
        textColor: '#ffffff',
        accentColor: '#fde68a',
        elements: [
            {
                id: createElementId(),
                type: 'heading',
                content: 'Squad highlight',
                fontSize: 34,
                fontWeight: '700',
                textAlign: 'center',
                textTransform: 'uppercase',
            },
            {
                id: createElementId(),
                type: 'text',
                content: '{{name}} climbed to level {{level}} with {{xp}} XP',
                fontSize: 20,
                fontWeight: '500',
                textAlign: 'center',
            },
            {
                id: createElementId(),
                type: 'stat',
                content: '{{badges}} badges',
                subContent: 'Unlocked',
                fontSize: 18,
                fontWeight: '600',
                textAlign: 'center',
                background: 'rgba(15,23,42,0.35)',
                borderRadius: 18,
            },
            {
                id: createElementId(),
                type: 'stat',
                content: '{{streak}} days',
                subContent: 'Current streak',
                fontSize: 18,
                fontWeight: '600',
                textAlign: 'center',
                background: 'rgba(15,23,42,0.35)',
                borderRadius: 18,
            },
        ],
    },
    {
        id: 'default-darkwave',
        name: 'Darkwave',
        description: 'Moody noir card with highlight strip and freeform HTML slot.',
        background: '#0b1120',
        overlay: 'linear-gradient(160deg, rgba(59,130,246,0.12), rgba(14,165,233,0.18))',
        textColor: '#f8fafc',
        accentColor: '#38bdf8',
        elements: [
            {
                id: createElementId(),
                type: 'heading',
                content: '{{name}} - Level {{level}}',
                fontSize: 28,
                fontWeight: '700',
                textAlign: 'left',
            },
            {
                id: createElementId(),
                type: 'text',
                content: 'XP banked: {{xp}}',
                fontSize: 18,
                fontWeight: '500',
                textAlign: 'left',
            },
            {
                id: createElementId(),
                type: 'text',
                content: 'Badges: {{badges}} - Rank #{{rank}}',
                fontSize: 16,
                fontWeight: '400',
                textAlign: 'left',
            },
            {
                id: createElementId(),
                type: 'html',
                content: '',
                html: '<div style="margin-top:16px;padding:12px;border:1px dashed rgba(56,189,248,0.6);border-radius:12px;text-align:center;font-size:0.85rem;color:#bae6fd;">Drop a custom message or CTA here.</div>',
            },
        ],
    },
];

export const TEMPLATE_STORAGE_KEY = 'zea-highlight-templates-v1';

export const cloneTemplate = (template: HighlightTemplate): HighlightTemplate => ({
    ...template,
    elements: template.elements.map((element) => ({ ...element })),
});

export const applyTemplateTokens = (value: string, tokens: Record<string, string>) =>
    value.replace(/\{\{(.*?)\}\}/g, (_, token) => tokens[token.trim()] ?? '');

export const elementToInlineStyle = (element: HighlightTemplateElement, template: HighlightTemplate) => {
    const styles: Record<string, string | number | undefined> = {
        color: element.color ?? template.textColor,
        textAlign: element.textAlign ?? 'center',
        textTransform: element.textTransform ?? 'none',
        letterSpacing: element.letterSpacing !== undefined ? `${element.letterSpacing}px` : undefined,
        lineHeight: element.lineHeight !== undefined ? `${element.lineHeight}` : undefined,
        fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
        fontWeight: element.fontWeight,
    };
    return Object.entries(styles)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}:${value}`)
        .join(';');
};

export const buildTemplateHtml = (template: HighlightTemplate, tokens: Record<string, string>) => {
    const elementsHtml = template.elements
        .map((element) => {
            if (element.type === 'heading' || element.type === 'subheading' || element.type === 'text') {
                const tag = element.type === 'heading' ? 'h1' : element.type === 'subheading' ? 'h2' : 'p';
                const style = elementToInlineStyle(element, template);
                return `<${tag} style="${style}">${applyTemplateTokens(element.content, tokens)}</${tag}>`;
            }
            if (element.type === 'stat') {
                const style = [
                    elementToInlineStyle(element, template),
                    `background:${element.background ?? 'rgba(15,23,42,0.4)'}`,
                    `border-radius:${element.borderRadius ?? 12}px`,
                    'padding:12px',
                    'margin:8px 0',
                ].join(';');
                const value = applyTemplateTokens(element.content, tokens);
                const label = element.subContent ? `<div style="font-size:12px;opacity:0.75;">${applyTemplateTokens(element.subContent, tokens)}</div>` : '';
                return `<div style="${style}"><div style="font-size:18px;font-weight:600;">${value}</div>${label}</div>`;
            }
            if (element.type === 'image') {
                const width = element.width ?? 320;
                const height = element.height ?? 180;
                const url = applyTemplateTokens(element.content, tokens);
                const containerStyle = [
                    `background:${element.background ?? 'rgba(15,23,42,0.2)'}`,
                    `border-radius:${element.borderRadius ?? 16}px`,
                    'overflow:hidden',
                    'display:flex',
                    'justify-content:center',
                    'margin:8px 0',
                ].join(';');
                return `<div style="${containerStyle}"><img src="${url}" alt="Highlight" style="width:${width}px;height:${height}px;object-fit:${element.imageFit ?? 'cover'};" /></div>`;
            }
            if (element.type === 'html') {
                return element.html ? applyTemplateTokens(element.html, tokens) : '';
            }
            return '';
        })
        .join('');

    const surfaceWrapperStart = template.surfaceColor
        ? `<div style="background:${template.surfaceColor};padding:24px;border-radius:24px;backdrop-filter:blur(12px);">`
        : '';
    const surfaceWrapperEnd = template.surfaceColor ? '</div>' : '';

    return `<!doctype html><html><head><meta charset="utf-8" /><title>Zea.Highlight</title></head><body style="margin:0;padding:0;background:${template.background};color:${template.textColor};font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
    <div style="position:relative;width:640px;max-width:90vw;padding:48px;border-radius:32px;overflow:hidden;background:${template.background};color:${template.textColor};">
        ${template.overlay ? `<div style="position:absolute;inset:0;background:${template.overlay};opacity:1;pointer-events:none;"></div>` : ''}
        <div style="position:relative;display:flex;flex-direction:column;gap:16px;">${surfaceWrapperStart}${elementsHtml}${surfaceWrapperEnd}</div>
    </div>
</body></html>`;
};

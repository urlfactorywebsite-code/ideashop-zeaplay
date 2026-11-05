import React from 'react';
import {
    HighlightTemplate,
    HighlightTemplateElement,
    applyTemplateTokens,
} from '../utils/highlightTemplates';

type HighlightPreviewProps = {
    template: HighlightTemplate;
    tokens: Record<string, string>;
    onElementClick?: (elementId: string) => void;
    selectedElementId?: string | null;
};

const HighlightPreview: React.FC<HighlightPreviewProps> = ({ template, tokens, onElementClick, selectedElementId }) => {
    const backgroundStyle: React.CSSProperties = {
        background: template.background,
        color: template.textColor,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '32px',
    };

    const overlayStyle: React.CSSProperties | undefined = template.overlay
        ? {
              background: template.overlay,
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
          }
        : undefined;

    const renderElement = (element: HighlightTemplateElement) => {
        const isSelected = selectedElementId === element.id;
        const commonStyle: React.CSSProperties = {
            color: element.color ?? template.textColor,
            textAlign: element.textAlign ?? 'center',
            textTransform: element.textTransform ?? 'none',
            letterSpacing: element.letterSpacing !== undefined ? `${element.letterSpacing}px` : undefined,
            lineHeight: element.lineHeight !== undefined ? `${element.lineHeight}` : undefined,
            fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
            fontWeight: element.fontWeight,
            cursor: onElementClick ? 'pointer' : 'default',
            border: isSelected ? '3px solid transparent' : 'none',
            borderRadius: isSelected ? '12px' : undefined,
            background: isSelected ? 'linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4, #ffeaa7, #dda0dd, #98d8c8) border-box' : undefined,
            boxShadow: isSelected ? '0 0 20px rgba(255, 107, 107, 0.8), inset 0 0 20px rgba(255, 255, 255, 0.1)' : undefined,
            animation: isSelected ? 'rainbowGlow 2s infinite' : undefined,
            transition: 'all 0.2s ease',
        };

        const handleClick = () => {
            if (onElementClick) {
                onElementClick(element.id);
            }
        };

        if (element.type === 'heading' || element.type === 'subheading' || element.type === 'text' || element.type === 'richtext' || element.type === 'signature' || element.type === 'watermark' || element.type === 'recipientname' || element.type === 'awardtitle' || element.type === 'eventfield' || element.type === 'datefield' || element.type === 'issuerblock' || element.type === 'dynamicplaceholder') {
            return (
                <p key={element.id} style={commonStyle} className="whitespace-pre-wrap" onClick={handleClick}>
                    {applyTemplateTokens(element.content, tokens)}
                </p>
            );
        }

        if (element.type === 'stat' || element.type === 'progressbar' || element.type === 'badgecounter') {
            const statStyle: React.CSSProperties = {
                ...commonStyle,
                background: element.background ?? 'rgba(15,23,42,0.4)',
                borderRadius: element.borderRadius ?? 12,
                padding: '12px',
            };
            if (element.type === 'progressbar') {
                return (
                    <div key={element.id} style={statStyle} onClick={handleClick}>
                        <div className="w-full rounded-full bg-gray-300 dark:bg-gray-700 h-4">
                            <div
                                className="h-4 rounded-full bg-primary"
                                style={{ width: `${element.progress ?? 0}%` }}
                            />
                        </div>
                    </div>
                );
            }
            return (
                <div key={element.id} style={statStyle} className="space-y-1" onClick={handleClick}>
                    <div className="text-base font-semibold">
                        {applyTemplateTokens(element.content, tokens)}
                    </div>
                    {element.subContent ? (
                        <div className="text-xs opacity-70">
                            {applyTemplateTokens(element.subContent, tokens)}
                        </div>
                    ) : null}
                </div>
            );
        }

        if (element.type === 'image') {
            const width = element.width ?? 320;
            const height = element.height ?? 180;
            const url = applyTemplateTokens(element.content, tokens);
            const containerStyle: React.CSSProperties = {
                background: element.background ?? 'rgba(15,23,42,0.2)',
                borderRadius: element.borderRadius ?? 16,
                overflow: 'hidden',
                display: 'flex',
                justifyContent: 'center',
                cursor: onElementClick ? 'pointer' : 'default',
                border: isSelected ? '2px solid #ff6b6b' : 'none',
                boxShadow: isSelected ? '0 0 10px rgba(255, 107, 107, 0.5)' : undefined,
                transition: 'all 0.2s ease',
            };
            return (
                <div key={element.id} style={containerStyle} onClick={handleClick}>
                    <img
                        src={url}
                        alt="Highlight"
                        style={{ width: `${width}px`, height: `${height}px`, objectFit: element.imageFit ?? 'cover' }}
                    />
                </div>
            );
        }

        if (element.type === 'html') {
            return (
                <div
                    key={element.id}
                    className="highlight-html"
                    style={{
                        color: element.color ?? template.textColor,
                        cursor: onElementClick ? 'pointer' : 'default',
                        border: isSelected ? '2px solid #ff6b6b' : 'none',
                        borderRadius: isSelected ? '8px' : undefined,
                        boxShadow: isSelected ? '0 0 10px rgba(255, 107, 107, 0.5)' : undefined,
                        transition: 'all 0.2s ease',
                    }}
                    onClick={handleClick}
                    dangerouslySetInnerHTML={{ __html: applyTemplateTokens(element.html ?? '', tokens) }}
                />
            );
        }

        return null;
    };

    return (
        <div className="relative overflow-hidden" style={backgroundStyle}>
            {overlayStyle ? <div style={overlayStyle} /> : null}
            <div className="relative flex min-h-[420px] flex-col gap-4 p-8">
                {template.surfaceColor ? (
                    <div
                        className="rounded-3xl p-8"
                        style={{ background: template.surfaceColor, color: template.textColor }}
                    >
                        <div className="flex flex-col gap-4">{template.elements.map(renderElement)}</div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">{template.elements.map(renderElement)}</div>
                )}
            </div>
        </div>
    );
};

export default HighlightPreview;

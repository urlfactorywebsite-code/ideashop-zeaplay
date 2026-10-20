import type { MailCategory, SmtpProfileInput, SmtpProvider } from '../types/smtp';

export const mailCategories: Array<{ value: MailCategory; label: string }> = [
    { value: 'general', label: 'General messages / fallback' }, { value: 'notifications', label: 'Notifications' },
    { value: 'otp', label: 'OTP and credential security' }, { value: 'rewards', label: 'Rewards' },
    { value: 'system_alerts', label: 'System alerts' }, { value: 'task_updates', label: 'Task and ticket updates' },
    { value: 'welcome', label: 'Welcome emails' },
];
export function blankProfile(): SmtpProfileInput {
    return { name: '', provider: 'custom', host: '', port: 587, username: '', password: '', encryption: 'tls', priority: 100,
        is_enabled: true, auth_method: 'password', sender_name: null, sender_email: null, reply_to: null,
        rate_limit_per_minute: 60, daily_limit: 1000, notification_types: ['notifications'] };
}
export function providerPreset(provider: SmtpProvider, region = 'com', business = false): Partial<SmtpProfileInput> {
    const host = { custom: '', gmail: 'smtp.gmail.com', outlook_com: 'smtp-mail.outlook.com', microsoft365: 'smtp.office365.com',
        zoho: region === 'custom' ? '' : `${business ? 'smtppro' : 'smtp'}.zoho.${region}`,
        mailgun: region === 'eu' ? 'smtp.eu.mailgun.org' : 'smtp.mailgun.org',
        sendgrid: region === 'eu' ? 'smtp.eu.sendgrid.net' : 'smtp.sendgrid.net' }[provider];
    if (!host && provider !== 'zoho') return {};
    return { host, port: 587, encryption: 'tls', auth_method: ['outlook_com', 'microsoft365'].includes(provider) ? 'oauth2' : 'password',
        username: provider === 'sendgrid' ? 'apikey' : '' };
}
export function profilePresetOptions(profile: Pick<SmtpProfileInput, 'provider' | 'host'>): { region: string; business: boolean } {
    const host = profile.host.toLowerCase();
    if (profile.provider === 'zoho') {
        const match = /^(smtp|smtppro)\.zoho\.(com|eu|in|com\.au|jp)$/.exec(host);
        return { region: match?.[2] || 'custom', business: match?.[1] === 'smtppro' };
    }
    return { region: host === 'smtp.eu.mailgun.org' || host === 'smtp.eu.sendgrid.net' ? 'eu' : 'com', business: false };
}
export function applyPreset(draft: SmtpProfileInput, preset: Partial<SmtpProfileInput>, touched: Set<string>): SmtpProfileInput {
    const result = { ...draft };
    for (const [key, value] of Object.entries(preset)) {
        if (!touched.has(key)) Object.assign(result, { [key]: value });
    }
    if (result.auth_method === 'oauth2') result.is_enabled = false;
    return result;
}
export function profilePayload(draft: SmtpProfileInput): SmtpProfileInput {
    const { password, ...settings } = draft;
    return { ...settings, name: settings.name.trim(), sender_name: settings.sender_name?.trim() || null,
        sender_email: settings.sender_email?.trim() || null, reply_to: settings.reply_to?.trim() || null,
        ...(password?.trim() ? { password } : {}) };
}

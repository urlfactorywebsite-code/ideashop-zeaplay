import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPreset, blankProfile, profilePayload, providerPreset, profilePresetOptions } from '../utils/smtpProfiles';

test('provider presets define SMTP transports and protect modified values', () => {
    const fresh = applyPreset(blankProfile(), providerPreset('gmail'), new Set());
    assert.equal(fresh.host, 'smtp.gmail.com'); assert.equal(fresh.port, 587); assert.equal(fresh.encryption, 'tls');
    const custom = { ...fresh, host: 'approved.example.com', port: 465, encryption: 'ssl' as const, password: 'new-transient-value' };
    const next = applyPreset(custom, providerPreset('sendgrid'), new Set(['host', 'port', 'encryption', 'password']));
    assert.equal(next.host, custom.host); assert.equal(next.port, 465); assert.equal(next.encryption, 'ssl');
    assert.equal(next.password, custom.password); assert.equal(next.username, 'apikey');
    assert.equal(providerPreset('mailgun', 'eu').host, 'smtp.eu.mailgun.org');
    assert.equal(providerPreset('zoho', 'in', true).host, 'smtppro.zoho.in');
    assert.equal(providerPreset('zoho', 'custom').host, '');
    const microsoft = applyPreset(blankProfile(), providerPreset('microsoft365'), new Set());
    assert.equal(microsoft.auth_method, 'oauth2'); assert.equal(microsoft.is_enabled, false);
});

test('regional edit controls reflect saved hosts and untouched relay usernames reset safely', () => {
    assert.deepEqual(profilePresetOptions({ provider: 'zoho', host: 'smtppro.zoho.in' }), { region: 'in', business: true });
    assert.deepEqual(profilePresetOptions({ provider: 'zoho', host: 'smtp.zohocloud.ca' }), { region: 'custom', business: false });
    assert.equal(profilePresetOptions({ provider: 'mailgun', host: 'smtp.eu.mailgun.org' }).region, 'eu');
    assert.equal(profilePresetOptions({ provider: 'sendgrid', host: 'smtp.eu.sendgrid.net' }).region, 'eu');
    const sendgrid = applyPreset(blankProfile(), providerPreset('sendgrid'), new Set());
    assert.equal(sendgrid.username, 'apikey');
    assert.equal(applyPreset(sendgrid, providerPreset('gmail'), new Set()).username, '');
    assert.equal(applyPreset({ ...sendgrid, username: 'typed@example.com' }, providerPreset('gmail'), new Set(['username'])).username, 'typed@example.com');
    for (const provider of ['outlook_com', 'microsoft365'] as const) {
        const draft = applyPreset(blankProfile(), providerPreset(provider), new Set());
        assert.equal(draft.port, 587); assert.equal(draft.encryption, 'tls');
        assert.equal(draft.auth_method, 'oauth2'); assert.equal(draft.is_enabled, false);
    }
    assert.deepEqual(providerPreset('custom'), {});
});

test('blank passwords are omitted from create/update payloads; replacements remain write-only', () => {
    const blank = blankProfile();
    assert.equal('password' in profilePayload(blank), false);
    assert.equal('password' in profilePayload({ ...blank, password: '   ' }), false);
    assert.equal(profilePayload({ ...blank, password: ' synthetic replacement ' }).password, ' synthetic replacement ');
    assert.equal(profilePayload({ ...blank, sender_email: '', reply_to: '' }).sender_email, null);
    assert.notEqual(blankProfile().notification_types, blankProfile().notification_types);
});

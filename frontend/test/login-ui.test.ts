import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const login = readFileSync(new URL('../pages/Login.tsx', import.meta.url), 'utf8');
const background = readFileSync(new URL('../components/login/AnimatedLoginBackground.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/Login.css', import.meta.url), 'utf8');

test('login redesign retains auth handler, redirect, validation, recovery and autofill contracts', () => {
    assert.match(login, /await login\(email, password\);\s+audio.current\?\.play\('success'\);\s+navigate\(from, \{ replace: true \}\);/);
    assert.match(login, /location.state\?\.from\?\.pathname \|\| '\/'/);
    assert.match(login, /id="email-address" name="email" type="email" autoComplete="email" required/);
    assert.match(login, /autoComplete="current-password" required/);
    assert.match(login, /<ForgotPasswordModal isOpen=\{isForgotPasswordOpen\}/);
    assert.match(login, /type="submit" disabled=\{isSubmitting\}/);
    assert.match(login, /role="alert"/);
    assert.ok(!login.includes('Ballpit') && !login.includes('HERO_ART'));
});

test('all three real supplied PNG backgrounds are bundled, not remote or fabricated artwork', () => {
    for (const filename of ['login1.png', 'login2.png', 'login3.png']) {
        assert.ok(background.includes(`images/favicon/${filename}`));
        const asset = readFileSync(new URL(`../images/favicon/${filename}`, import.meta.url));
        assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.ok(asset.readUInt32BE(16) >= 1000 && asset.readUInt32BE(20) >= 700);
    }
    assert.match(background, /aria-hidden="true"/);
    assert.match(background, /fetchPriority=\{index === 0 \? 'high' : 'low'\}/);
    assert.match(background, /await image.decode\(\)/);
    assert.match(css, /\.login-environment\[data-ready="false"\] \.login-scene:first-child \{ opacity: 1;/);
});

test('login animation is pausable, reduced-motion safe and has no JS animation loops', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /animation-play-state: paused/);
    assert.match(css, /\.login-scene:first-child \{ opacity: 1;/);
    assert.match(login, /aria-pressed=\{isMotionPaused\}/);
    assert.match(login, /return \(\) => media.removeEventListener\('change', update\)/);
    assert.ok(!/setInterval|requestAnimationFrame/.test(login + background));
    assert.ok(!/\d(?:vw|cqw)/.test(css), 'Typography must not scale with viewport width');
});

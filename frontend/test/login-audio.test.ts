import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginAudio } from '../components/login/loginAudio';

function audioFixture() {
    const voices: Array<{ frequency: number; stopped: boolean; stopAt: number | undefined; ended: (() => void) | null }> = [];
    const fades: Array<{ value: number; at: number }> = [];
    let creations = 0;
    let closed = 0;
    const context = {
        state: 'suspended', currentTime: 1, destination: {},
        resume: async () => { context.state = 'running'; },
        close: async () => { context.state = 'closed'; closed++; },
        createGain: () => ({
            gain: { value: .018, cancelScheduledValues() {}, setValueAtTime() {},
                linearRampToValueAtTime(value: number, at: number) { fades.push({ value, at }); }, exponentialRampToValueAtTime() {} },
            connect() {}, disconnect() {},
        }),
        createOscillator: () => {
            const voice = { frequency: 0, stopped: false, stopAt: undefined as number | undefined, ended: null as (() => void) | null };
            voices.push(voice);
            return {
                frequency: { setValueAtTime(value: number) { voice.frequency = value; } },
                set onended(callback: () => void) { voice.ended = callback; },
                connect() {}, disconnect() {}, start() {},
                stop(at: number) { voice.stopped = true; voice.stopAt = at; },
            };
        },
    };
    const audio = new LoginAudio(() => { creations++; return context as unknown as AudioContext; });
    return { audio, voices, fades, context, creations: () => creations, closed: () => closed };
}

test('audio stays uninitialized by default; mute suppresses every cue', async () => {
    const f = audioFixture();
    for (const cue of ['press', 'success', 'error'] as const) f.audio.play(cue);
    assert.equal(f.creations(), 0);
    assert.equal(await f.audio.setEnabled(true), true);
    f.audio.play('press');
    assert.equal(f.voices.length, 2);
    assert.equal(await f.audio.setEnabled(false), false);
    f.audio.play('success');
    f.audio.play('error');
    assert.equal(f.voices.length, 2);
    assert.ok(f.voices.every(voice => voice.stopped));
    assert.ok(f.voices.every(voice => voice.stopAt === 1.018));
    assert.equal(f.fades.filter(fade => fade.value === 0 && fade.at === 1.012).length, 2);
    f.voices.forEach(voice => voice.ended?.());
    f.audio.dispose();
    assert.equal(f.closed(), 1);
});

test('a context suspended before navigation closes immediately even when onended cannot run', async () => {
    const f = audioFixture();
    await f.audio.setEnabled(true);
    f.audio.play('press');
    f.context.state = 'suspended';
    f.audio.dispose();
    assert.equal(f.closed(), 1);
});

test('an interrupted success tail has bounded cleanup without relying on onended', async () => {
    const f = audioFixture();
    await f.audio.setEnabled(true);
    f.audio.play('success');
    f.audio.dispose();
    f.context.state = 'suspended';
    await new Promise(resolve => setTimeout(resolve, 430));
    assert.equal(f.closed(), 1);
});

test('confirmed-success notes finish across navigation and release the audio context', async () => {
    const f = audioFixture();
    await f.audio.setEnabled(true);
    f.audio.play('success');
    assert.equal(f.voices.length, 3);
    assert.ok(f.voices[0].frequency < f.voices[2].frequency);
    f.audio.dispose();
    assert.equal(f.closed(), 0);
    f.audio.play('press');
    assert.equal(f.voices.length, 3);
    f.voices.forEach(voice => voice.ended?.());
    assert.equal(f.closed(), 1);
    assert.equal(await f.audio.setEnabled(true), false);
});

test('unavailable audio and rejected resume fail quietly without enabling sound', async () => {
    const unavailable = new LoginAudio(() => { throw new Error('No audio device'); });
    assert.equal(await unavailable.setEnabled(true), false);
    assert.doesNotThrow(() => unavailable.play('error'));
    unavailable.dispose();
    const f = audioFixture();
    f.context.resume = async () => { throw new Error('Gesture denied'); };
    assert.equal(await f.audio.setEnabled(true), false);
    f.audio.play('press');
    assert.equal(f.voices.length, 0);
    f.audio.dispose();
    assert.equal(f.closed(), 1);
});

test('muting while audio activation is pending cannot turn sound back on', async () => {
    const f = audioFixture();
    let finish!: () => void;
    f.context.resume = () => new Promise<void>(resolve => { finish = () => { f.context.state = 'running'; resolve(); }; });
    const enabling = f.audio.setEnabled(true);
    await f.audio.setEnabled(false);
    finish();
    assert.equal(await enabling, false);
    f.audio.play('press');
    assert.equal(f.voices.length, 0);
    f.audio.dispose();
    assert.equal(f.closed(), 1);
});

export type LoginCue = 'press' | 'success' | 'error';

const notes: Record<LoginCue, number[]> = {
    press: [520, 780],
    success: [660, 880, 1100],
    error: [330, 260],
};

/** Lazy, gesture-activated audio. No browser APIs run until explicitly enabled. */
export class LoginAudio {
    private context: AudioContext | null = null;
    private voices = new Map<OscillatorNode, GainNode>();
    private enabled = false;
    private disposed = false;
    private generation = 0;
    private closeTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private createContext: () => AudioContext = () => new AudioContext()) {}

    async setEnabled(enabled: boolean): Promise<boolean> {
        const generation = ++this.generation;
        this.enabled = false;
        if (!enabled || this.disposed) {
            this.stopVoices();
            return false;
        }
        try {
            this.context ??= this.createContext();
            if (this.context.state === 'suspended') await this.context.resume();
            if (generation !== this.generation || this.disposed) return false;
            this.enabled = this.context.state === 'running';
            return this.enabled;
        } catch {
            if (generation === this.generation && this.voices.size === 0) this.close();
            return false;
        }
    }

    play(cue: LoginCue): void {
        const context = this.context;
        if (!this.enabled || this.disposed || !context || context.state !== 'running') return;
        // Bound rapid interactions without allowing audio errors to affect authentication.
        if (this.voices.size > 6) return;
        try {
            notes[cue].forEach((frequency, index) => {
                const start = context.currentTime + index * .075;
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(frequency, start);
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(.018, start + .012);
                gain.gain.exponentialRampToValueAtTime(.0001, start + .12);
                oscillator.connect(gain);
                gain.connect(context.destination);
                this.voices.set(oscillator, gain);
                oscillator.onended = () => {
                    oscillator.disconnect();
                    gain.disconnect();
                    this.voices.delete(oscillator);
                    if (this.disposed && this.voices.size === 0) this.close();
                };
                oscillator.start(start);
                oscillator.stop(start + .13);
            });
        } catch { /* Sound is optional and never changes the login result. */ }
    }

    private stopVoices(): void {
        const now = this.context?.currentTime || 0;
        this.voices.forEach((gain, voice) => {
            try {
                // Fade before stopping to avoid a discontinuity/click when the user mutes.
                gain.gain.cancelScheduledValues(now);
                gain.gain.setValueAtTime(Math.max(.0001, gain.gain.value), now);
                gain.gain.linearRampToValueAtTime(0, now + .012);
                voice.stop(now + .018);
            } catch { try { voice.stop(); } catch { /* Already ended. */ } }
        });
    }

    private close(): void {
        if (this.closeTimer !== null) clearTimeout(this.closeTimer);
        this.closeTimer = null;
        if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => undefined);
        this.context = null;
        this.voices.clear();
    }

    dispose(): void {
        this.disposed = true;
        this.enabled = false;
        ++this.generation;
        // Let the short confirmed-success cue finish across navigation, then release audio.
        if (this.voices.size === 0 || this.context?.state !== 'running') {
            this.stopVoices();
            this.close();
        } else if (this.closeTimer === null) {
            // A tab/audio interruption must not leave a suspended context waiting for onended.
            this.closeTimer = setTimeout(() => { this.stopVoices(); this.close(); }, 400);
        }
    }
}

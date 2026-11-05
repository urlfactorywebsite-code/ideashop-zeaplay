import { memo } from 'react';

/** A normalized SVG path keeps the light on the rounded perimeter at every size. */
const LoginConsoleEffects = memo(function LoginConsoleEffects() {
    return (
        <div className="login-console-effects" aria-hidden="true">
            <div className="login-console-aura" />
            <svg className="login-energy-border" focusable="false">
                <rect className="login-border-track" pathLength="1000" />
                <rect className="login-border-halo login-border-runner" pathLength="1000" />
                <rect className="login-border-tail" pathLength="1000" />
                <rect className="login-border-runner" pathLength="1000" />
                <rect className="login-border-core" pathLength="1000" />
            </svg>
            <span className="login-hud-corner login-hud-top" />
            <span className="login-hud-corner login-hud-bottom" />
            <span className="login-orbit-ring" />
            <span className="login-glass-bubble login-bubble-one" />
            <span className="login-glass-bubble login-bubble-two" />
            <span className="login-glass-bubble login-bubble-three" />
            <span className="login-glass-bubble login-bubble-four" />
        </div>
    );
});

export default LoginConsoleEffects;

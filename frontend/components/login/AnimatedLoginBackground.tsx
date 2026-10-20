import { memo, useEffect, useRef, useState } from 'react';
import { Star, Trophy, Zap } from 'lucide-react';
import login1 from '../../images/login1.png';
import login2 from '../../images/login2.png';
import login3 from '../../images/login3.png';

const scenes = [login3, login1, login2];

const AnimatedLoginBackground = memo(function AnimatedLoginBackground({ reducedMotion = false }: { reducedMotion?: boolean }) {
    const container = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let mounted = true;
        setReady(false);
        const decodeScenes = async () => {
            const images = container.current?.querySelectorAll<HTMLImageElement>('.login-scene');
            if (!images) return;
            for (const image of images) {
                if (!mounted) return;
                if (reducedMotion && image !== images[0]) continue;
                await image.decode();
            }
            if (mounted) setReady(true);
        };
        // Keep the first scene static if another image is slow or unavailable.
        void decodeScenes().catch(() => undefined);
        return () => { mounted = false; };
    }, [reducedMotion]);

    return (
        <div className="login-environment" aria-hidden="true" data-ready={ready} ref={container}>
            <div className="login-scenes">
                {scenes.map((src, index) => <img key={src} src={reducedMotion && index > 0 ? undefined : src} alt="" className={`login-scene login-scene-${index + 1}`}
                    decoding="async" fetchPriority={index === 0 ? 'high' : 'low'} draggable={false} />)}
            </div>
            <div className="login-vignette" />
            <div className="login-environment-glow" />
            <div className="login-smoke login-smoke-left" />
            <div className="login-smoke login-smoke-right" />
            <div className="login-ground-haze" />
            <div className="login-light-streak" />
            <div className="login-scanline" />
            <div className="login-game-token login-game-token-star"><Star size={21} /></div>
            <div className="login-game-token login-game-token-trophy"><Trophy size={22} /></div>
            <div className="login-game-token login-game-token-zap"><Zap size={19} /></div>
            <div className="login-spark login-spark-one" /><div className="login-spark login-spark-two" />
            <div className="login-spark login-spark-three" />
        </div>
    );
});

export default AnimatedLoginBackground;

import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/mockApi';
import { Reward } from '../types';
import { GiftIcon, ShieldCheckIcon } from './icons';

interface ClaimedRewardModalProps {
  isOpen: boolean;
  rewardId: string | null;
  onClose: () => void;
}

const Confetti: React.FC = () => {
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'];
    
    const confettiPieces = useMemo(() => Array.from({ length: 100 }).map((_, i) => {
        const style = {
            left: `${Math.random() * 100}%`,
            backgroundColor: colors[Math.floor(Math.random() * colors.length)],
            animationDelay: `${Math.random() * 3}s`,
            transform: `rotate(${Math.random() * 360}deg)`,
        };
        return <div key={i} className="confetti" style={style}></div>;
    }), []);

    return <div className="confetti-container">{confettiPieces}</div>;
}

const ClaimedRewardModal: React.FC<ClaimedRewardModalProps> = ({ isOpen, rewardId, onClose }) => {
    const [reward, setReward] = useState<Reward | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showConfetti, setShowConfetti] = useState(false);

    useEffect(() => {
        if (isOpen && rewardId) {
            setLoading(true);
            setError('');
            setReward(null);
            setShowConfetti(false);

            const timer = setTimeout(() => setShowConfetti(true), 300);

            api.getReward(rewardId)
                .then(setReward)
                .catch(err => setError(err.message || 'Could not load reward.'))
                .finally(() => setLoading(false));
            
            return () => clearTimeout(timer);
        }
    }, [isOpen, rewardId]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4" onClick={onClose}>
            <div className="bg-surface p-8 rounded-lg shadow-xl w-full max-w-md border border-border-color text-center relative" onClick={e => e.stopPropagation()}>
                {showConfetti && <Confetti />}
                
                <div className="animate-shake mb-4 inline-block">
                    <GiftIcon className="h-20 w-20 text-yellow-400" />
                </div>

                <h2 className="text-2xl font-bold mb-2 text-white">Reward Claimed!</h2>

                {loading ? (
                    <p className="text-text-secondary">Loading your reward...</p>
                ) : error ? (
                    <p className="text-red-400">{error}</p>
                ) : reward ? (
                    <div>
                        <h3 className="text-xl font-semibold text-primary">{reward.title}</h3>
                        <p className="text-text-secondary mt-2">{reward.description}</p>
                        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-green-500/15 px-4 py-1.5 text-sm font-semibold text-green-200">
                            <ShieldCheckIcon className="h-4 w-4" />
                            {reward.xpRequired.toLocaleString()} XP
                        </p>
                    </div>
                ) : null}
                
                <button 
                    onClick={onClose} 
                    className="mt-8 w-full py-2 px-4 bg-primary text-white rounded-md hover:bg-primary-dark"
                >
                    Awesome!
                </button>
            </div>
        </div>
    );
};

export default ClaimedRewardModal;

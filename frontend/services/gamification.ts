import { Task, User, TaskStatus } from '../types';
import { calculateTaskPoints } from '../utils/taskPoints';

export interface GamificationStats {
  points: number;
  streak: number;
  badges: Badge[];
  achievements: GamificationAchievement[];
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface GamificationAchievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  points: number;
  unlockedAt: string;
  progress: number;
  maxProgress: number;
}


export interface AchievementPopup {

  id: string;

  achievement: GamificationAchievement;

  show: boolean;

}


class GamificationService {
  private static instance: GamificationService;
  private achievements: GamificationAchievement[] = [];
  private badges: Badge[] = [];
  private achievementPopups: AchievementPopup[] = [];

  private constructor() {
    this.initializeAchievements();
  }

  static getInstance(): GamificationService {
    if (!GamificationService.instance) {
      GamificationService.instance = new GamificationService();
    }
    return GamificationService.instance;
  }

  private initializeAchievements() {
    this.achievements = [
      {
        id: 'first-task',
        title: 'First Steps',
        description: 'Complete your first task',
        icon: '🎯',
        points: 10,
        unlockedAt: '',
        progress: 0,
        maxProgress: 1,
      },
      {
        id: 'task-master',
        title: 'Task Master',
        description: 'Complete 10 tasks',
        icon: '👑',
        points: 50,
        unlockedAt: '',
        progress: 0,
        maxProgress: 10,
      },
      {
        id: 'streak-warrior',
        title: 'Streak Warrior',
        description: 'Maintain a 7-day completion streak',
        icon: '🔥',
        points: 100,
        unlockedAt: '',
        progress: 0,
        maxProgress: 7,
      },
      {
        id: 'priority-champion',
        title: 'Priority Champion',
        description: 'Complete 5 urgent tasks',
        icon: '⚡',
        points: 75,
        unlockedAt: '',
        progress: 0,
        maxProgress: 5,
      },
    ];
  }

  calculatePoints(task: Task): number {
    return calculateTaskPoints(task).totalAwarded;
  }

  calculateStreak(tasks: Task[], userId: string): number {
    const userTasks = tasks.filter(task =>
      task.assignedTo?.includes(userId) &&
      (task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED) &&
      task.completedAt
    );

    if (userTasks.length === 0) return 0;

    // Sort by completion date
    userTasks.sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());

    let streak = 1;
    let currentDate = new Date(userTasks[0].completedAt!);
    currentDate.setHours(0, 0, 0, 0);

    for (let i = 1; i < userTasks.length; i++) {
      const taskDate = new Date(userTasks[i].completedAt!);
      taskDate.setHours(0, 0, 0, 0);

      const diffTime = currentDate.getTime() - taskDate.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);

      if (diffDays === 1) {
        streak++;
        currentDate = taskDate;
      } else if (diffDays > 1) {
        break;
      }
    }

    return streak;
  }

  updateAchievements(tasks: Task[], user: User): GamificationAchievement[] {
    const completedTasks = tasks.filter(task =>
      task.assignedTo?.includes(user.id) &&
      (task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED)
    );

    const urgentTasks = completedTasks.filter(task => task.priority === 'URGENT');

    this.achievements.forEach(achievement => {
      switch (achievement.id) {
        case 'first-task':
          achievement.progress = completedTasks.length > 0 ? 1 : 0;
          break;
        case 'task-master':
          achievement.progress = Math.min(completedTasks.length, 10);
          break;
        case 'streak-warrior':
          achievement.progress = this.calculateStreak(tasks, user.id);
          break;
        case 'priority-champion':
          achievement.progress = Math.min(urgentTasks.length, 5);
          break;
      }

      if (achievement.progress >= achievement.maxProgress && !achievement.unlockedAt) {
        achievement.unlockedAt = new Date().toISOString();
        this.showAchievementPopup(achievement);
      }
    });

    return this.achievements;
  }

  private showAchievementPopup(achievement: GamificationAchievement) {
    const popup: AchievementPopup = {
      id: `popup-${Date.now()}`,
      achievement,
      show: true,
    };

    this.achievementPopups.push(popup);

    // Auto-hide after 5 seconds
    setTimeout(() => {
      const index = this.achievementPopups.findIndex(p => p.id === popup.id);
      if (index > -1) {
        this.achievementPopups[index].show = false;
      }
    }, 5000);
  }

  getAchievementPopups(): AchievementPopup[] {
    return this.achievementPopups.filter(popup => popup.show);
  }

  dismissPopup(popupId: string) {
    const index = this.achievementPopups.findIndex(p => p.id === popupId);
    if (index > -1) {
      this.achievementPopups.splice(index, 1);
    }
  }

  getGamificationStats(tasks: Task[], user: User): GamificationStats {
    const completedTasks = tasks.filter(task =>
      task.assignedTo?.includes(user.id) &&
      (task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED)
    );

    const totalPoints = completedTasks.reduce((sum, task) => sum + this.calculatePoints(task), 0);
    const streak = this.calculateStreak(tasks, user.id);
    const achievements = this.updateAchievements(tasks, user);

    // Generate badges based on achievements
    const badges: Badge[] = achievements
      .filter(ach => ach.unlockedAt)
      .map(ach => ({
        id: ach.id,
        name: ach.title,
        description: ach.description,
        icon: ach.icon,
        earnedAt: ach.unlockedAt,
        rarity: this.getBadgeRarity(ach.points),
      }));

    return {
      points: totalPoints,
      streak,
      badges,
      achievements,
    };
  }

  private getBadgeRarity(points: number): 'common' | 'rare' | 'epic' | 'legendary' {
    if (points >= 100) return 'legendary';
    if (points >= 75) return 'epic';
    if (points >= 50) return 'rare';
    return 'common';
  }

  getBadgeColor(rarity: string): string {
    switch (rarity) {
      case 'legendary': return 'from-yellow-400 to-orange-500';
      case 'epic': return 'from-purple-400 to-pink-500';
      case 'rare': return 'from-blue-400 to-cyan-500';
      default: return 'from-gray-400 to-gray-500';
    }
  }
}

export default GamificationService;

/**
 * Editorial recommendations for optimal posting times
 */

import type { PlatformRecommendation, PostingGuidelines } from '../platforms/types.js';

const RECOMMENDATIONS: Record<string, PlatformRecommendation> = {
  youtube: {
    days: ['Friday', 'Sunday'],
    hours: [14, 15, 18],
    frequency: '1-2 per week',
  },
  instagram: {
    days: ['Monday', 'Tuesday', 'Wednesday'],
    hours: [9, 11, 12],
    frequency: '2-5 per week',
  },
  facebook: {
    days: ['Monday', 'Tuesday', 'Wednesday'],
    hours: [9, 11, 13],
    frequency: '2-5 per week',
  },
  tiktok: {
    days: ['Tuesday', 'Thursday', 'Friday'],
    hours: [12, 16, 19],
    frequency: '1-3 per week',
  },
};

/**
 * Get posting recommendations for a platform
 */
export function getRecommendations(platform: string): PlatformRecommendation | null {
  return RECOMMENDATIONS[platform.toLowerCase()] || null;
}

/**
 * Get formatted posting guidelines
 */
export function getPostingGuidelines(platform: string): PostingGuidelines | null {
  const rec = RECOMMENDATIONS[platform.toLowerCase()];
  if (!rec) return null;

  return {
    platform,
    bestDays: rec.days.join(', '),
    bestHours: rec.hours.map((h) => `${h}:00`).join(', '),
    frequency: rec.frequency,
  };
}

/**
 * Calculate the next optimal posting time
 */
export function getOptimalPostingTime(
  platform: string,
  timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): Date {
  const rec = RECOMMENDATIONS[platform.toLowerCase()];
  if (!rec) return new Date();

  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Map day names to numbers
  const dayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  const targetDays = rec.days.map((d) => dayMap[d]).sort((a, b) => a - b);

  // Find next target day
  let daysToAdd = 0;
  let targetHour = rec.hours[0];

  // Check if today is a target day and we haven't passed all optimal hours
  if (targetDays.includes(currentDay)) {
    const nextHour = rec.hours.find((h) => h > currentHour);
    if (nextHour) {
      targetHour = nextHour;
    } else {
      // Move to next target day
      const currentIndex = targetDays.indexOf(currentDay);
      const nextIndex = (currentIndex + 1) % targetDays.length;
      daysToAdd = targetDays[nextIndex] - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
    }
  } else {
    // Find next target day
    const nextDay = targetDays.find((d) => d > currentDay);
    if (nextDay !== undefined) {
      daysToAdd = nextDay - currentDay;
    } else {
      daysToAdd = targetDays[0] + 7 - currentDay;
    }
  }

  const optimalTime = new Date(now);
  optimalTime.setDate(optimalTime.getDate() + daysToAdd);
  optimalTime.setHours(targetHour, 0, 0, 0);

  return optimalTime;
}

/**
 * Get all platform recommendations
 */
export function getAllRecommendations(): Record<string, PlatformRecommendation> {
  return { ...RECOMMENDATIONS };
}

/**
 * Format recommendations as a readable string
 */
export function formatRecommendations(platform?: string): string {
  if (platform) {
    const guidelines = getPostingGuidelines(platform);
    if (!guidelines) return `No recommendations available for ${platform}`;

    return `Platform: ${guidelines.platform}
Best days: ${guidelines.bestDays}
Best hours: ${guidelines.bestHours}
Recommended frequency: ${guidelines.frequency}

Next optimal time: ${getOptimalPostingTime(platform).toLocaleString()}`;
  }

  // Return all platforms
  return Object.entries(RECOMMENDATIONS)
    .map(([platform, rec]) => {
      return `${platform.toUpperCase()}
- Best days: ${rec.days.join(', ')}
- Best hours: ${rec.hours.map((h) => `${h}:00`).join(', ')}
- Frequency: ${rec.frequency}`;
    })
    .join('\n\n');
}

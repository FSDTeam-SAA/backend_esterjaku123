// Single source of truth for the 5-point mood scale and the Sleep/Stress/Energy
// quality-badge thresholds used across mood, insights, and home controllers.

export const MOOD_SCALE = [
  { score: 1, label: "Terrible", emoji: "😣" },
  { score: 2, label: "Poor", emoji: "🙁" },
  { score: 3, label: "Okay", emoji: "😐" },
  { score: 4, label: "Good", emoji: "🙂" },
  { score: 5, label: "Amazing", emoji: "😄" },
];

export const MOOD_SCORES = MOOD_SCALE.map((m) => m.score);

export const CONTEXT_TAGS = [
  "Anxious",
  "Focused",
  "Grateful",
  "Tired",
  "Excited",
  "Calm",
  "Productive",
  "Stressed",
  "Motivated",
  "Relaxed",
  "Lonely",
  "Hopeful",
  "Overwhelmed",
  "Content",
];

export const WIN_CATEGORIES = [
  "Kind to myself",
  "Got things done",
  "Spent time with someone",
  "Took care of my health",
  "Learned something",
  "Something else",
];

export const getMoodLabel = (score) =>
  MOOD_SCALE.find((m) => m.score === score)?.label;

export const getMoodEmoji = (score) =>
  MOOD_SCALE.find((m) => m.score === score)?.emoji;

export const moodScoreToPercent = (score) => {
  if (typeof score !== "number") return null;
  return (score - 1) * 25; // 1..5 -> 0..100
};

// Sleep hours -> Good/Average/Not Good
const getSleepQuality = (hours) => {
  if (hours >= 7) return "Good";
  if (hours >= 5) return "Average";
  return "Not Good";
};

// Energy level (0-100 slider) -> Good/Average/Not Good
const getEnergyQuality = (level) => {
  if (level >= 60) return "Good";
  if (level >= 35) return "Average";
  return "Not Good";
};

// Stress level (0-100, derived as 100 - calmLevel) -> Good/Average/Not Good
// Low stress is "Good".
const getStressQuality = (level) => {
  if (level <= 35) return "Good";
  if (level <= 65) return "Average";
  return "Not Good";
};

export const getQualityLabel = (metric, value) => {
  if (value === undefined || value === null) return null;
  switch (metric) {
    case "sleep":
      return getSleepQuality(value);
    case "energy":
      return getEnergyQuality(value);
    case "stress":
      return getStressQuality(value);
    default:
      return null;
  }
};

// Word-only descriptor (distinct from quality badge) used for Stress/Energy display text.
export const getWordValue = (metric, value) => {
  if (value === undefined || value === null) return null;
  if (metric === "stress") {
    if (value <= 35) return "Low";
    if (value <= 65) return "Moderate";
    return "High";
  }
  if (metric === "energy") {
    if (value <= 35) return "Low";
    if (value <= 60) return "Average";
    return "High";
  }
  return null;
};

export const formatSleep = (hours) => {
  if (hours === undefined || hours === null) return null;
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return minutes > 0 ? `${wholeHours} hr ${minutes} min` : `${wholeHours} hr`;
};

export const deriveStressLevel = (calmLevel) => {
  if (typeof calmLevel !== "number") return null;
  return Math.min(100, Math.max(0, 100 - calmLevel));
};

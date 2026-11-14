export type ScoreTone = "good" | "ok" | "poor";

export function scoreTone(score: number): ScoreTone {
  return score >= 80 ? "good" : score >= 50 ? "ok" : "poor";
}

export const SCORE_LABEL: Record<ScoreTone, string> = { good: "ดีมาก", ok: "พอใช้", poor: "ควรปรับปรุง" };

export interface GameResult {
  reward: string;
  explanation: string;
  related_culture_id?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  reward: string;
}

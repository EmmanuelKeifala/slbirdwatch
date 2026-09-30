import { File, Paths } from 'expo-file-system';

// QZ-03: the quiz level this person last chose, kept on the device.
export type QuizLevel = 'beginner' | 'intermediate' | 'expert';
const file = () => new File(Paths.document, 'quiz-level.json');

export function quizLevel(): QuizLevel {
  try {
    const f = file();
    const v = f.exists ? JSON.parse(f.textSync()) : null;
    return v === 'beginner' || v === 'expert' ? v : 'intermediate';
  } catch {
    return 'intermediate';
  }
}

export function setQuizLevel(v: QuizLevel) {
  try {
    file().write(JSON.stringify(v));
  } catch {
    // Storage unavailable: the level holds for this session only.
  }
}

// QZ-05: answer by typing the name instead of picking from four.
const typingFile = () => new File(Paths.document, 'quiz-typing.json');

export function quizTyping(): boolean {
  try {
    const f = typingFile();
    return f.exists && JSON.parse(f.textSync()) === true;
  } catch {
    return false;
  }
}

export function setQuizTyping(v: boolean) {
  try {
    typingFile().write(JSON.stringify(v));
  } catch {
    // Storage unavailable: the choice holds for this session only.
  }
}

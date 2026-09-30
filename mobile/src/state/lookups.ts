import { File, Paths } from 'expo-file-system';

// Birds this person opened (from search, the library or a sighting), newest first, kept on the device.
// Quizzes favour them, alongside birds they got wrong and what the community recorded lately.
const MAX = 50;
const file = () => new File(Paths.document, 'looked-up.json');

export function lookups(): number[] {
  try {
    const f = file();
    return f.exists ? (JSON.parse(f.textSync()) as number[]) : [];
  } catch {
    return [];
  }
}

export function recordLookup(id: number) {
  try {
    file().write(JSON.stringify([id, ...lookups().filter((x) => x !== id)].slice(0, MAX)));
  } catch {
    // Storage unavailable: quizzes just won't know about this bird.
  }
}

import { File, Paths } from 'expo-file-system';

import { newCard, review, type Card, type Grade } from '@/srs';

// LRN-04: the flashcard deck, on the phone. Birds you miss in a quiz join it automatically.
// ponytail: phone-only for now; sync with the account like quiz progress (ACC-04) if people ask.
const file = () => new File(Paths.document, 'flashcards.json');

export function loadDeck(): Card[] {
  try {
    const f = file();
    return f.exists ? (JSON.parse(f.textSync()) as Card[]) : [];
  } catch {
    return [];
  }
}

function save(cards: Card[]) {
  try {
    file().write(JSON.stringify(cards));
  } catch {
    // storage unavailable: changes aren't kept
  }
}

/** Add birds to the deck (already there: left as they are). */
export function addToDeck(speciesIds: number[]) {
  const deck = loadDeck();
  const have = new Set(deck.map((c) => c.speciesId));
  const now = Date.now();
  const add = [...new Set(speciesIds)].filter((id) => !have.has(id)).map((id) => newCard(id, now));
  if (add.length) save([...deck, ...add]);
}

export const inDeck = (speciesId: number) => loadDeck().some((c) => c.speciesId === speciesId);

/** Reschedule a card; returns the time used, so screens can refresh their clock. */
export function gradeCard(speciesId: number, grade: Grade): number {
  const now = Date.now();
  save(loadDeck().map((c) => (c.speciesId === speciesId ? review(c, grade, now) : c)));
  return now;
}

export function removeFromDeck(speciesId: number) {
  save(loadDeck().filter((c) => c.speciesId !== speciesId));
}

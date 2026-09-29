// QZ-05: is a typed bird name close enough? Case, accents, hyphens and punctuation don't matter, and small typos
// are forgiven: 1 edit for names up to 8 letters, 2 up to 16, 3 beyond. Either the English or scientific name.

export function normalise(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function distance(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

const allowance = (len: number) => (len <= 8 ? 1 : len <= 16 ? 2 : 3);

/** 'exact' | 'close' (right, with a typo) | 'wrong'. Names that differ only in spaces count as exact. */
export function matchName(typed: string, names: string[]): 'exact' | 'close' | 'wrong' {
  const t = normalise(typed);
  if (t.length < 3) return 'wrong';
  let best: 'close' | 'wrong' = 'wrong';
  for (const n of names.map(normalise).filter(Boolean)) {
    if (t === n || t.replace(/ /g, '') === n.replace(/ /g, '')) return 'exact';
    if (distance(t, n) <= allowance(n.length)) best = 'close';
  }
  return best;
}

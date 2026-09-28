const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How to describe when a bird is recorded in Sierra Leone, from GBIF records per month (Jan..Dec). */
export function seasonText(months: number[]): { title: string; caption: string } {
  const total = months.reduce((a, b) => a + b, 0);
  if (total < 5) return { title: 'Rarely recorded', caption: `${total} record${total === 1 ? '' : 's'} so far` };
  const seen = months.filter((n) => n > 0).length;
  if (seen >= 10) return { title: 'Year-round', caption: `Seen in ${seen} of 12 months` };
  // Longest run of months with records, wrapping round the year (Nov–Apr).
  let start = 0;
  let len = 0;
  for (let i = 0; i < 12; i++) {
    if (months[i] === 0 || months[(i + 11) % 12] > 0) continue; // runs start after an empty month
    let n = 0;
    while (n < 12 && months[(i + n) % 12] > 0) n++;
    if (n > len) [start, len] = [i, n];
  }
  const title = len === 1 ? SHORT[start] : `${SHORT[start]}–${SHORT[(start + len - 1) % 12]}`;
  return { title, caption: seen === len ? 'Seasonal visitor' : 'Mostly; a few other months too' };
}

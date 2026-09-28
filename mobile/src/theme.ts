// Tokens from design/DESIGN.md (sampled from design/refs/screen-*.png). Light only, like the design.

const colors = {
  ink: '#17144B', // headlines, primary text, active icons
  inkMuted: '#7B7A8C', // body copy, locations
  inkFaint: '#A3A2B3', // inactive tab icons, placeholders
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  field: '#F4F3FA', // inputs
  border: '#ECEBF3', // card outlines
  primary: '#17144B', // primary button, centre tab button
  onPrimary: '#FFFFFF',
  accent: '#7B6FF0', // add tile, selected chips
  accentDeep: '#4B40C9', // count badge, links
  onAccent: '#FFFFFF',
  tint: '#E9E7FC', // round icon buttons
  tintIcon: '#6C60E8',
  tiles: ['#EFEEFB', '#E6F5EF', '#F3E5E6', '#F3F0DC', '#E7EEFA'], // pastel bird backgrounds
  night: ['#15124A', '#3B2F9E', '#7462E0', '#C79AD8'] as const, // onboarding gradient
  correct: '#2FA86B',
  wrong: '#E5484D',
  rare: '#F2A900',
};

export type Colors = typeof colors;

export const useColors = (): Colors => colors;

/** Stable pastel tile colour for an id. */
export const tileFor = (c: Colors, id: number) => c.tiles[Math.abs(id) % c.tiles.length];

export const font = {
  display: 'BricolageGrotesque_800ExtraBold',
  regular: 'PlusJakartaSans_400Regular',
  italic: 'PlusJakartaSans_400Regular_Italic',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

export const radius = { chip: 12, tile: 22, card: 28, pill: 999 };
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, screen: 20 };

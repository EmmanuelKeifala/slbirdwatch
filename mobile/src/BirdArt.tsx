import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

// Flat geometric birds in the style of design/refs. Used wherever a species has no photo yet;
// the palette is picked from the species id so each bird keeps its look.
const PALETTES = [
  { body: '#A3A6B8', wing: '#7C7F95', belly: '#F4C542', beak: '#3B3A4C' }, // grey & yellow
  { body: '#3FAE6A', wing: '#2B8A52', belly: '#7AD9BE', beak: '#3B3A4C' }, // green
  { body: '#8A4A2B', wing: '#5B2F1C', belly: '#D9A066', beak: '#F2B233' }, // brown
  { body: '#4C6FDB', wing: '#2F4BA8', belly: '#D0703F', beak: '#2A2A3A' }, // blue
  { body: '#F2C230', wing: '#CE9E14', belly: '#FFE27F', beak: '#E27A5F' }, // yellow
  { body: '#9C8F2F', wing: '#6F6620', belly: '#F1D256', beak: '#3B3A2C' }, // olive
];

export function BirdArt({ id, size = 120 }: { id: number; size?: number }) {
  const p = PALETTES[Math.abs(id) % PALETTES.length];
  const gid = `perch${Math.abs(id) % PALETTES.length}`;
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 100 120">
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#C8303F" />
          <Stop offset="1" stopColor="#2A1A3A" />
        </LinearGradient>
      </Defs>
      {/* perch */}
      <Rect x={48.5} y={74} width={3} height={46} fill={`url(#${gid})`} />
      {/* tail */}
      <Polygon points="30,74 14,104 21,107 40,80" fill={p.wing} />
      {/* body */}
      <Path d="M28 60 Q32 40 55 37 Q73 37 75 52 Q75 70 58 79 Q40 86 28 74 Z" fill={p.body} />
      {/* belly */}
      <Path d="M54 50 Q71 49 73 57 Q71 71 57 79 Q48 82 44 77 Q47 61 54 50 Z" fill={p.belly} />
      {/* wing with feather lines */}
      <G>
        <Path d="M30 52 Q46 44 60 55 L40 80 Q27 72 30 52 Z" fill={p.wing} />
        <Path d="M36 60 L52 58 M35 66 L48 64 M36 72 L45 70" stroke={p.body} strokeWidth={1.4} strokeLinecap="round" />
      </G>
      {/* head, beak, eye */}
      <Circle cx={64} cy={33} r={13} fill={p.body} />
      <Polygon points="76,30 91,34 76,38" fill={p.beak} />
      <Circle cx={68.5} cy={30.5} r={3.2} fill="#FFFFFF" />
      <Circle cx={69.2} cy={30.5} r={1.7} fill="#17144B" />
      {/* perch ring (feet) */}
      <Circle cx={50} cy={78} r={3.6} fill="none" stroke="#C9674F" strokeWidth={1.8} />
    </Svg>
  );
}

/** The golden bird in flight from the onboarding screen. */
export function FlyingBird({ size = 280 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.75} viewBox="0 0 160 120">
      <Polygon points="20,95 70,70 78,80 34,102" fill="#E8A92A" />
      <Path d="M52 66 Q40 30 58 8 Q86 22 92 58 Z" fill="#FCEFB4" />
      <Path d="M58 8 Q86 22 92 58 L74 60 Q70 30 58 8 Z" fill="#F3DD8A" />
      <Path d="M44 78 Q70 56 104 58 Q124 60 126 70 Q120 86 96 92 Q66 98 44 78 Z" fill="#F6C436" />
      <Path d="M70 84 L100 80 M66 90 L94 87" stroke="#E0A91F" strokeWidth={2} strokeLinecap="round" />
      <Circle cx={118} cy={58} r={13} fill="#F6C436" />
      <Polygon points="129,56 144,60 129,64" fill="#F29C9C" />
      <Circle cx={121} cy={55} r={3} fill="#FFFFFF" />
      <Circle cx={121.8} cy={55} r={1.6} fill="#17144B" />
    </Svg>
  );
}

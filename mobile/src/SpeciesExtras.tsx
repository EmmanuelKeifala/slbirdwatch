import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { mediaUrl, similarSpecies, type SimilarSpecies, type SpeciesDetail } from '@/api';
import { seasonText } from '@/season';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';

// Richer pieces of the species page: fact tiles, male vs female, swipeable "at a glance" cards, a quiz nudge.

type Icon = ComponentProps<typeof Feather>['name'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const IUCN = {
  '': '',
  LC: 'Least concern',
  NT: 'Near threatened',
  VU: 'Vulnerable',
  EN: 'Endangered',
  CR: 'Critically endangered',
  DD: 'Data deficient',
  EW: 'Extinct in the wild',
  EX: 'Extinct',
} as const;
const THREATENED = ['VU', 'EN', 'CR', 'EW', 'EX'];

/** "18–20 cm" → a familiar comparison. */
export function sizeLike(length: string) {
  const cm = parseFloat(length);
  if (!cm) return '';
  if (cm < 12) return 'Smaller than a sparrow';
  if (cm < 18) return 'About sparrow-sized';
  if (cm < 28) return 'About thrush-sized';
  if (cm < 40) return 'About pigeon-sized';
  if (cm < 60) return 'About crow-sized';
  return 'A big bird';
}

function Tile({ icon, value, caption, bg, alert }: { icon: Icon; value: string; caption: string; bg: string; alert?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.tile, { backgroundColor: bg }]}>
      <View style={[styles.tileIcon, { backgroundColor: 'rgba(255,255,255,0.7)' }]}>
        <Feather name={icon} size={16} color={alert ? c.wrong : c.tintIcon} />
      </View>
      <Text style={[styles.tileValue, { color: c.ink }]} numberOfLines={2}>
        {value}
      </Text>
      <Text style={[styles.tileCaption, { color: c.inkMuted }]} numberOfLines={2}>
        {caption}
      </Text>
    </View>
  );
}

/** Swipeable fact tiles under the name. */
export function FactTiles({ sp }: { sp: SpeciesDetail }) {
  const c = useColors();
  const now = new Date().getMonth();
  const tiles: ComponentProps<typeof Tile>[] = [];
  if (sp.details?.length) tiles.push({ icon: 'maximize-2', value: sp.details.length, caption: sizeLike(sp.details.length), bg: c.tiles[0] });
  if (sp.details?.iucn)
    tiles.push({
      icon: THREATENED.includes(sp.details.iucn) ? 'alert-triangle' : 'shield',
      value: IUCN[sp.details.iucn],
      caption: 'IUCN Red List',
      bg: THREATENED.includes(sp.details.iucn) ? '#FDECEC' : c.tiles[1],
      alert: THREATENED.includes(sp.details.iucn),
    });
  if (sp.sensitive)
    tiles.push({ icon: 'eye-off', value: 'Protected', caption: `Sightings shown to about ${sp.obscure_km} km`, bg: c.tiles[2] });
  if (sp.region) {
    const s = seasonText(sp.region.months);
    tiles.push({ icon: 'calendar', value: s.title, caption: `In Sierra Leone · ${s.caption}`, bg: c.tiles[4] });
    const around = sp.region.months[now] + sp.region.months[(now + 11) % 12] + sp.region.months[(now + 1) % 12];
    tiles.push({
      icon: around ? 'eye' : 'eye-off',
      value: around ? 'Look out now' : 'Unlikely now',
      caption: `Around ${MONTHS[now]}`,
      bg: c.tiles[3],
    });
  }
  if (!tiles.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles} style={styles.bleed}>
      {tiles.map((t) => (
        <Tile key={t.icon} {...t} />
      ))}
    </ScrollView>
  );
}

/** Male and female photos side by side, with what the text says about telling them apart. */
export function SpotTheDifference({ sp }: { sp: SpeciesDetail }) {
  const c = useColors();
  const male = sp.gallery.find((g) => g.variant === 'male');
  const female = sp.gallery.find((g) => g.variant === 'female');
  if (!male || !female) return null;
  const text = sp.details?.highlights.find((h) => h.title === 'Males and females')?.text;
  return (
    <View style={[styles.card, { backgroundColor: c.field }]}>
      <Text style={[styles.kicker, { color: c.accentDeep }]}>SPOT THE DIFFERENCE</Text>
      <View style={styles.pair}>
        {[
          { p: male, label: 'Male', icon: 'arrow-up-right' as Icon },
          { p: female, label: 'Female', icon: 'plus' as Icon },
        ].map(({ p, label }) => (
          <View key={label} style={{ flex: 1, gap: 6 }}>
            <Image source={{ uri: mediaUrl(p.thumb_url) }} style={styles.pairImg} accessibilityLabel={`${label} ${sp.english_name}`} />
            <Text style={[styles.pairLabel, { color: c.ink }]}>{label}</Text>
            <Text style={[styles.credit, { color: c.inkFaint }]} numberOfLines={1}>
              {p.credit} · {p.licence}
            </Text>
          </View>
        ))}
      </View>
      {!!text && <Text style={[styles.body, { color: c.inkMuted }]}>{text}</Text>}
    </View>
  );
}

const GLANCE: Record<string, { icon: Icon; tile: number }> = {
  'Males and females': { icon: 'users', tile: 0 },
  'Young birds': { icon: 'feather', tile: 1 },
  'Through the year': { icon: 'sun', tile: 3 },
  Voice: { icon: 'music', tile: 4 },
};

/** "At a glance" facts as swipeable cards. */
export function GlanceCards({ sp }: { sp: SpeciesDetail }) {
  const c = useColors();
  const items = sp.details?.highlights ?? [];
  if (!items.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={292}
      decelerationRate="fast"
      contentContainerStyle={styles.tiles}
      style={styles.bleed}
    >
      {items.map((h) => {
        const g = GLANCE[h.title] ?? { icon: 'info' as Icon, tile: 2 };
        return (
          <View key={h.title} style={[styles.glance, { backgroundColor: c.tiles[g.tile] }]}>
            <View style={styles.glanceHead}>
              <View style={[styles.tileIcon, { backgroundColor: 'rgba(255,255,255,0.7)' }]}>
                <Feather name={g.icon} size={16} color={c.tintIcon} />
              </View>
              <Text style={[styles.glanceTitle, { color: c.ink }]}>{h.title}</Text>
            </View>
            <Text style={[styles.body, { color: c.ink }]} numberOfLines={9}>
              {h.text}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** A nudge to practise: a picture quiz on this bird's family. */
export function QuizCard({ sp }: { sp: SpeciesDetail }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/quiz', params: { family: sp.family_sci } })}
      accessibilityRole="button"
      style={styles.quizWrap}
    >
      <LinearGradient colors={[c.night[0], c.night[1], c.night[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quiz}>
        <Text style={styles.quizKicker}>TEST YOURSELF</Text>
        <Text style={styles.quizTitle}>Could you pick it out from its relatives?</Text>
        <Text style={styles.quizBody}>A 10-question picture quiz on the {sp.family_en.toLowerCase()} family.</Text>
        <View style={[styles.quizButton, { backgroundColor: '#FFFFFF' }]}>
          <Text style={[styles.quizButtonText, { color: c.ink }]}>Play the quiz</Text>
          <Feather name="arrow-right" size={16} color={c.ink} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -(space.screen + 8) },
  tiles: { gap: space.m, paddingHorizontal: space.screen + 8, paddingVertical: space.xs },
  tile: { width: 150, borderRadius: radius.tile, padding: space.l, gap: 6 },
  tileIcon: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileValue: { fontFamily: font.bold, fontSize: 17, lineHeight: 21 },
  tileCaption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
  card: { borderRadius: radius.card, padding: space.l, gap: space.m },
  kicker: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2 },
  pair: { flexDirection: 'row', gap: space.m },
  pairImg: { width: '100%', aspectRatio: 1, borderRadius: radius.tile },
  pairLabel: { fontFamily: font.bold, fontSize: 15 },
  credit: { fontFamily: font.medium, fontSize: 11 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 23 },
  glance: { width: 280, borderRadius: radius.card, padding: space.l, gap: space.m },
  glanceHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  glanceTitle: { fontFamily: font.bold, fontSize: 16 },
  quizWrap: { marginTop: space.xl },
  similar: { width: 132, borderWidth: 1.5, borderRadius: radius.tile, padding: space.s, gap: 4 },
  similarImg: { width: '100%', aspectRatio: 1, borderRadius: radius.chip, overflow: 'hidden' },
  similarName: { fontFamily: font.bold, fontSize: 13, lineHeight: 17 },
  compare: { flexDirection: 'row', alignItems: 'center', gap: space.s, borderRadius: radius.pill, paddingHorizontal: space.l, minHeight: 48 },
  compareText: { flex: 1, fontFamily: font.semibold, fontSize: 14 },
  quiz: { borderRadius: radius.card, padding: space.xl, gap: space.s },
  quizKicker: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2, color: '#C9C2FF' },
  quizTitle: { fontFamily: font.display, fontSize: 26, lineHeight: 28, color: '#FFFFFF' },
  quizBody: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: '#E3E0FF' },
  quizButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    height: 44,
    marginTop: space.s,
  },
  quizButtonText: { fontFamily: font.semibold, fontSize: 15 },
});

const WHY = { confused: 'Often confused', genus: 'Same genus', family: 'Same family' } as const;

/** LIB-07: lookalikes (confused on community sightings, same genus, same family), with a compare button. */
export function SimilarSection({ sp, title }: { sp: SpeciesDetail; title: (text: string) => React.ReactNode }) {
  const c = useColors();
  const [items, setItems] = useState<SimilarSpecies[]>([]);
  useEffect(() => {
    similarSpecies(sp.id)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [sp.id]);
  if (!items.length) return null;
  return (
    <View style={{ gap: space.m }}>
      {title('Similar species')}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles} style={styles.bleed}>
        {items.map((s) => (
          <Pressable key={s.id} style={[styles.similar, { borderColor: c.border }]} onPress={() => router.push(`/species/${s.id}`)} accessibilityRole="button">
            <View style={[styles.similarImg, { backgroundColor: c.tiles[s.id % c.tiles.length] }]}>
              {s.thumb_url ? <Image source={{ uri: mediaUrl(s.thumb_url) }} style={StyleSheet.absoluteFill} /> : null}
            </View>
            <Text style={[styles.similarName, { color: c.ink }]} numberOfLines={2}>
              {s.english_name}
            </Text>
            <Text style={[styles.credit, { color: s.reason === 'confused' ? c.wrong : c.inkMuted }]}>
              {WHY[s.reason]}
              {s.local ? ' · SL' : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        style={[styles.compare, { backgroundColor: c.tint }]}
        onPress={() => router.push({ pathname: '/compare', params: { ids: [sp.id, ...items.slice(0, 2).map((s) => s.id)].join(',') } })}
        accessibilityRole="button"
      >
        <Feather name="columns" size={16} color={c.tintIcon} />
        <Text style={[styles.compareText, { color: c.ink }]}>
          Compare with {items[0].english_name}
          {items.length > 1 ? ` and ${items[1].english_name}` : ''}
        </Text>
      </Pressable>
    </View>
  );
}

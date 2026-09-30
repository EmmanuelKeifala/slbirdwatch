import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { Pressable } from '@/components/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cachedSpecies, getSpecies, isAdmin, knownSpecies, mediaUrl, sightingsMap, speciesPhotos, type CommunityPhoto, type MapSquare, type SpeciesDetail } from '@/api';
import { useAuth } from '@/state/auth';
import { languageLabel } from '@/lib/languages';
import { LICENCES } from '@/lib/licences';
import { recordLookup } from '@/state/lookups';
import { addToDeck, inDeck, removeFromDeck } from '@/state/deck';
import { Gallery } from '@/components/Gallery';
import { IdTips } from '@/components/IdTips';
import { MonthChart } from '@/components/MonthChart';
import { Mnemonic } from '@/components/Mnemonic';
import { packSpecies } from '@/state/offlinePack';
import { shareSpecies } from '@/lib/share';
import { tagText } from '@/components/PhotoTags';
import { signInFirst } from '@/lib/nav';
import { StaticMap } from '@/components/StaticMap';
import { HeroMedia } from '@/components/HeroMedia';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SoundGallery } from '@/components/SoundGallery';
import { SoundPlayer } from '@/components/SoundPlayer';
import { FactTiles, GlanceCards, QuizCard, SimilarSection, SpotTheDifference } from '@/components/SpeciesExtras';
import { font, radius, space, useColors } from '@/theme';

/** Species page — design/refs/screen-detail.png. */
export default function Species() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token;
  const [sp, setSp] = useState<SpeciesDetail | null>(() => cachedSpecies(Number(id)) ?? null);
  const primed = knownSpecies.get(Number(id)); // from the list you tapped: name and thumbnail while details load
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<CommunityPhoto[]>([]);
  const [squares, setSquares] = useState<MapSquare[]>([]);
  const [offline, setOffline] = useState(false);
  const [seen, setSeen] = useState<number[]>([]); // LIB-06: community sightings per month
  const scroll = useRef<ScrollView>(null);
  const [more, setMore] = useState(false);
  const [inDeckNow, setInDeckNow] = useState(() => inDeck(Number(id)));
  const [textY, setTextY] = useState(0);
  const ys = useRef<Record<string, number>>({});
  const setY = (key: string, y: number) => (ys.current[key] = y);
  const jump = (key: string) => scroll.current?.scrollTo({ y: textY + (ys.current[key] ?? 0) - space.m, animated: true });

  useEffect(() => {
    getSpecies(Number(id))
      .then((d) => {
        setSp(d);
        recordLookup(d.id); // quizzes favour birds you looked up
      })
      .catch((e) => {
        const saved = packSpecies(Number(id)); // LIB-11: no signal, but it's in the offline guide
        if (saved) {
          setSp(saved);
          setOffline(true);
        } else setError(e instanceof Error ? e.message : String(e));
      });
    speciesPhotos(Number(id))
      .then((p) => setPhotos(p.items))
      .catch(() => {});
    sightingsMap(Number(id), token)
      .then((m) => {
        setSquares(m.items);
        setSeen(m.months);
      })
      .catch(() => {});
  }, [id, token]);

  const heroUrl = sp ? (sp.image?.url ?? sp.gallery[0]?.url ?? photos[0]?.url ?? null) : null;


  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader
        title={sp?.english_name ?? primed?.english_name ?? ''}
        back
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
            {sp && (
              <Pressable onPress={() => shareSpecies(sp.id, sp.english_name)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Share a link">
                <Feather name="share-2" size={22} color={c.ink} />
              </Pressable>
            )}
            {isAdmin(session?.user) && (
              <Pressable
                onPress={() => router.push(`/species-admin/${id}`)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Species admin: local names, merge or split"
              >
                <Feather name="more-horizontal" size={24} color={c.ink} />
              </Pressable>
            )}
          </View>
        }
      />
      {!sp ? (
        <View style={primed ? undefined : styles.center}>
          {primed && (
            <HeroMedia id={primed.id} uri={primed.image ? mediaUrl(primed.image.thumb_url) : null} actions={[]} sharedTag={`species-${id}`} />
          )}
          {error ? (
            <Text style={[styles.body, { color: c.wrong, margin: space.xl }]}>Couldn’t load this bird. Check your connection.</Text>
          ) : (
            <ActivityIndicator style={{ margin: space.xl }} color={c.accent} />
          )}
        </View>
      ) : (
        <>
          <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 130 }}>
            <HeroMedia
              id={sp.id}
              sharedTag={`species-${id}`}
              uri={heroUrl ? mediaUrl(heroUrl) : null}
              placeholder={sp.image && heroUrl === sp.image.url ? mediaUrl(sp.image.thumb_url) : undefined}
              chips={[
                ...(sp.gallery.some((g) => g.reference) || (sp.image && !sp.image.source_url.includes('wiki')) ? ['★ Reference photo'] : []),
                ...(sp.region ? ['Sierra Leone bird'] : []),
              ]}
              actions={[
                {
                  icon: 'play',
                  label: 'Listen',
                  count: sp.sounds.length || (sp.sound ? 1 : 0),
                  onPress: () =>
                    sp.sound || sp.sounds.length
                      ? jump('call')
                      : Alert.alert('No recording yet', 'Calls will appear here as they are added.'),
                },
                {
                  icon: 'map',
                  label: 'Range',
                  onPress: sp.region?.gbif_key
                    ? () => jump('map')
                    : () =>
                        Alert.alert(
                          'No range map for this bird',
                          'Range maps cover the birds recorded in Sierra Leone. This one hasn’t been recorded there.',
                        ),
                },
                {
                  icon: 'image',
                  label: 'Photos',
                  count: sp.gallery.length + photos.length,
                  onPress: () =>
                    sp.gallery.length || photos.length
                      ? jump(sp.gallery.length ? 'photos' : 'community')
                      : Alert.alert('No photos yet', 'Photos from verified sightings of this bird will appear here.'),
                },
              ]}
            />

            {sp.image && (
              <Pressable
                onPress={() => sp.image!.source_url && Linking.openURL(sp.image!.source_url)}
                disabled={!sp.image.source_url}
                accessibilityRole="link"
              >
                <Text style={[styles.credit, { color: c.inkFaint }]} numberOfLines={2}>
                  Photo: {sp.image.credit || 'Unknown'} · {sp.image.licence} ·{' '}
                  {sp.image.source_url.includes('inaturalist')
                    ? 'iNaturalist'
                    : sp.image.source_url
                      ? 'Wikimedia Commons'
                      : 'SL Birdwatch community'}
                </Text>
              </Pressable>
            )}
            {!sp.image && sp.gallery[0] && (
              <Pressable onPress={() => Linking.openURL(sp.gallery[0].source_url)} accessibilityRole="link">
                <Text style={[styles.credit, { color: c.inkFaint }]} numberOfLines={2}>
                  Photo: {sp.gallery[0].credit} · {sp.gallery[0].licence} · iNaturalist
                </Text>
              </Pressable>
            )}

            <View style={styles.text} onLayout={(e) => setTextY(e.nativeEvent.layout.y)}>
              {offline && (
                <View style={[styles.offline, { backgroundColor: c.tint }]}>
                  <Feather name="wifi-off" size={14} color={c.tintIcon} />
                  <Text style={[styles.small, { color: c.ink, marginTop: 0, flex: 1 }]}>
                    No signal: this is your offline guide. Galleries, maps and community sightings need a connection.
                  </Text>
                </View>
              )}
              <Text style={[styles.name, { color: c.ink }]} accessibilityRole="header">
                {sp.english_name}
              </Text>
              <Text style={[styles.sci, { color: c.inkMuted }]}>{sp.scientific_name}</Text>
              <Pressable
                style={[styles.deckPill, { backgroundColor: inDeckNow ? c.tint : c.field }]}
                onPress={() => {
                  if (inDeckNow) removeFromDeck(sp.id);
                  else addToDeck([sp.id]);
                  setInDeckNow(!inDeckNow);
                }}
                accessibilityRole="button"
              >
                <Feather name={inDeckNow ? 'check' : 'layers'} size={13} color={c.tintIcon} />
                <Text style={[styles.deckText, { color: c.ink }]}>{inDeckNow ? 'In your flashcards' : 'Add to flashcards'}</Text>
              </Pressable>
              {sp.local_names.length > 0 && (
                <Text style={[styles.family, { color: c.ink }]}>
                  {sp.local_names.map((n) => `${languageLabel(n.language)}: ${n.name}`).join(' · ')}
                </Text>
              )}
              {sp.merged_into && (
                <Pressable
                  style={[styles.notice, { backgroundColor: c.tint }]}
                  onPress={() => router.replace(`/species/${sp.merged_into!.id}`)}
                  accessibilityRole="link"
                >
                  <Feather name="git-merge" size={16} color={c.tintIcon} />
                  <Text style={[styles.noticeText, { color: c.ink }]}>
                    Now part of the {sp.merged_into.english_name} after a taxonomy update. Open it ›
                  </Text>
                </Pressable>
              )}
              {sp.split_into.length > 0 && (
                <View style={[styles.notice, { backgroundColor: c.tint, flexDirection: 'column', alignItems: 'flex-start' }]}>
                  <Text style={[styles.noticeText, { color: c.ink }]}>Split into these species after a taxonomy update:</Text>
                  {sp.split_into.map((x) => (
                    <Pressable key={x.id} onPress={() => router.push(`/species/${x.id}`)} accessibilityRole="link">
                      <Text style={[styles.noticeText, { color: c.accentDeep }]}>{x.english_name} ›</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Text style={[styles.family, { color: c.inkMuted }]}>
                {sp.family_en} · {sp.order_name.charAt(0) + sp.order_name.slice(1).toLowerCase()}
              </Text>

              <View style={{ marginTop: space.xl }}>
                <FactTiles sp={sp} />
              </View>

              {sp.sounds.length > 0 ? (
                <Section title="Listen" onY={(y) => setY('call', y)}>
                  <Mnemonic speciesId={sp.id} name={sp.english_name} text={sp.mnemonic ?? ''} />
                  <SoundGallery sounds={sp.sounds} />
                </Section>
              ) : (
                sp.sound && (
                  <Section title="Listen" onY={(y) => setY('call', y)}>
                    <Mnemonic speciesId={sp.id} name={sp.english_name} text={sp.mnemonic ?? ''} />
                    <SoundPlayer sound={sp.sound} caption={`${sp.sound.credit} · ${sp.sound.licence}`} />
                    <Pressable onPress={() => Linking.openURL(sp.sound!.source_url)} accessibilityRole="link">
                      <Text style={[styles.small, { color: c.inkFaint, marginLeft: space.s }]}>Recording from xeno-canto.org</Text>
                    </Pressable>
                  </Section>
                )
              )}

              <View style={{ marginTop: space.xl }}>
                <SpotTheDifference sp={sp} />
              </View>

              {!!sp.details?.highlights.length && (
                <Section title="At a glance">
                  <GlanceCards sp={sp} />
                </Section>
              )}

              <IdTips speciesId={sp.id} name={sp.english_name} title={(t) => <Text style={[styles.h2, { color: c.ink, marginTop: space.xxl }]}>{t}</Text>} />
              <SimilarSection sp={sp} title={(t) => <Text style={[styles.h2, { color: c.ink, marginTop: space.xxl }]}>{t}</Text>} />

              {sp.gallery.length > 0 && (
                <Section title="Photos" onY={(y) => setY('photos', y)}>
                  <Gallery photos={sp.gallery} />
                </Section>
              )}

              {(sp.region || seen.some((n) => n > 0)) && (
                <Section title="Best time to see it">
                  {sp.region && (
                    <>
                      <MonthChart months={sp.region.months} />
                      <Text style={[styles.small, { color: c.inkFaint }]}>
                        {sp.region.records} records in Sierra Leone on GBIF.org. More birders go out in the dry season, so busy
                        months partly reflect that.
                      </Text>
                    </>
                  )}
                  {seen.some((n) => n > 0) && (
                    <>
                      <Text style={[styles.chartTitle, { color: c.ink }]}>Seen by the community</Text>
                      <MonthChart months={seen} />
                      <Text style={[styles.small, { color: c.inkFaint }]}>Sightings logged in this app, by month.</Text>
                    </>
                  )}
                </Section>
              )}

              {!!sp.region?.gbif_key && (
                <Section title="Where it’s been recorded" onY={(y) => setY('map', y)}>
                  <StaticMap
                    gbifKey={sp.region.gbif_key}
                    label="Map of where this bird has been recorded"
                    title={`Where the ${sp.english_name} is recorded`}
                  />
                  <Text style={[styles.small, { color: c.inkFaint }]}>Tap the map to explore it full screen.</Text>
                </Section>
              )}

              {squares.length > 0 && (
                <Section title="Seen by the community">
                  <StaticMap squares={squares} label="Map of community sightings" title={`${sp.english_name} sightings`} />
                  <Text style={[styles.small, { color: c.inkFaint }]}>
                    {squares.reduce((t, q) => t + q.n, 0)} sightings in this app, shown as ~5 km squares (darker = more).
                    {sp.sensitive ? ' This bird is sensitive, so its squares are larger.' : ''}
                  </Text>
                </Section>
              )}

              {photos.length > 0 && (
                <Section title="From the community" onY={(y) => setY('community', y)}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.m }}>
                    {photos.map((p) => (
                      <Pressable key={p.id} onPress={() => router.push(`/sighting/${p.observation_id}`)} accessibilityRole="button">
                        <Image source={{ uri: mediaUrl(p.thumb_url) }} style={styles.thumb} accessibilityLabel={`Photo by ${p.credit}`} />
                        <Text style={[styles.small, { color: c.inkFaint, width: 132 }]} numberOfLines={1}>
                          {p.credit} · {LICENCES.find((l) => l.value === p.licence)?.label}
                        </Text>
                        {!!p.tags?.length && (
                          <Text style={[styles.small, { color: c.ink, width: 132 }]} numberOfLines={1}>
                            {tagText(p.tags)}
                          </Text>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </Section>
              )}

              <Section title="About">
                <Text style={[styles.body, { color: c.inkMuted }]}>
                  {sp.english_name} belongs to the {sp.family_en.toLowerCase()} family ({sp.family_sci}), in the order{' '}
                  {sp.order_name}.{sp.extinct ? ' This species is extinct.' : ''}
                  {sp.breeding_range ? ` Breeds: ${sp.breeding_range}.` : ''}
                  {sp.nonbreeding_range ? ` Outside the breeding season: ${sp.nonbreeding_range}.` : ''}
                </Text>
              </Section>

              {sp.details && (
                <>
                  <Pressable onPress={() => setMore(!more)} accessibilityRole="button" style={[styles.moreRow, { backgroundColor: c.field }]}>
                    <Text style={[styles.moreText, { color: c.ink }]}>{more ? 'Hide the full description' : 'Read the full description'}</Text>
                    <Feather name={more ? 'chevron-up' : 'chevron-down'} size={20} color={c.ink} />
                  </Pressable>
                  {more &&
                    sp.details.sections.map((sec) => (
                      <View key={sec.title}>
                        <Text style={[styles.h3, { color: c.ink }]}>{sec.title}</Text>
                        <Text style={[styles.body, { color: c.inkMuted }]}>{sec.text}</Text>
                      </View>
                    ))}
                  <Pressable onPress={() => Linking.openURL(sp.details!.source_url)} accessibilityRole="link">
                    <Text style={[styles.small, { color: c.inkFaint, marginTop: space.m }]}>
                      Text from Wikipedia · {sp.details.licence} · read the full article
                    </Text>
                  </Pressable>
                </>
              )}

              {!sp.extinct && <QuizCard sp={sp} />}
            </View>
          </ScrollView>

          {!sp.extinct && (
            <View style={styles.ctaWrap}>
              <Pressable
                style={({ pressed }) => [styles.cta, { backgroundColor: c.primary }, pressed && { opacity: 0.9 }]}
                onPress={() => {
                  const params = { speciesId: String(sp.id), name: sp.english_name, sci: sp.scientific_name };
                  if (session) router.push({ pathname: '/observe', params });
                  else
                    signInFirst(
                      `Sign in to log your ${sp.english_name}.`,
                      `/observe?${Object.entries(params)
                        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                        .join('&')}`,
                    );
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.ctaText, { color: c.onPrimary }]}>I saw this bird</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

/** A titled block of the page; reports its position so the round buttons can jump to it. */
function Section({ title, onY, children }: { title: string; onY?: (y: number) => void; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ marginTop: space.xxl }} onLayout={onY && ((e) => onY(e.nativeEvent.layout.y))}>
      <Text style={[styles.h2, { color: c.ink }]}>{title}</Text>
      <View style={{ gap: space.s }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  offline: { flexDirection: 'row', alignItems: 'center', gap: space.s, borderRadius: radius.tile, padding: space.m, marginBottom: space.m },
  chartTitle: { fontFamily: font.bold, fontSize: 14, marginTop: space.m },
  h3: { fontFamily: font.bold, fontSize: 15, marginTop: space.l, marginBottom: 4 },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xl,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    height: 48,
  },
  moreText: { fontFamily: font.semibold, fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  hero: { height: 290, marginTop: space.s },
  panel: {
    position: 'absolute',
    left: 110,
    right: 0,
    top: 60,
    bottom: 10,
    borderTopLeftRadius: 40,
    borderBottomLeftRadius: 40,
    overflow: 'hidden',
  },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  credit: { fontFamily: font.medium, fontSize: 11, textAlign: 'right', paddingHorizontal: space.screen, marginTop: space.xs },
  thumb: { width: 132, height: 132, borderRadius: radius.tile },
  small: { fontFamily: font.medium, fontSize: 11, marginTop: 4 },
  art: { position: 'absolute', right: 10, top: 0 },
  actions: { position: 'absolute', left: space.screen + 20, top: 60, gap: space.l },
  text: { paddingHorizontal: space.screen + 8, marginTop: space.xl },
  name: { fontFamily: font.display, fontSize: 44, lineHeight: 46 },
  sci: { fontFamily: font.italic, fontSize: 15, marginTop: space.s },
  family: { fontFamily: font.semibold, fontSize: 13, marginTop: 2 },
  deckPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 6, marginTop: space.m },
  deckText: { fontFamily: font.semibold, fontSize: 13 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.s, borderRadius: radius.tile, padding: space.m, marginTop: space.m },
  noticeText: { flex: 1, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  h2: { fontFamily: font.display, fontSize: 24, lineHeight: 28, marginBottom: space.m },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 24 },
  ctaWrap: { position: 'absolute', left: space.screen, right: space.screen, bottom: space.xl },
  cta: { height: 58, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: font.semibold, fontSize: 16 },
});

import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { FollowButton } from '@/FollowButton';
import { shareSighting } from '@/share';
import { FormScroll } from '@/FormScroll';
import { Pressable } from '@/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  blockUser,
  deleteObservation,
  flagObservation,
  getObservation,
  mediaUrl,
  observationHistory,
  reportUser,
  isModerator,
  isVerifier,
  moderateSighting,
  setQuizSuitable,
  setPhotoTags,
  likeSighting,
  setReference,
  shownSpecies,
  type PhotoTag,
  type SoundTag,
  type Edit,
  type FlagReason,
  type UserReportReason,
  type Observation,
} from '@/api';
import { useAuth } from '@/auth';
import { Comments } from '@/Comments';
import { CommunityId } from '@/CommunityId';
import { LICENCES } from '@/licences';
import { SOUND_TAGS, TagEditor, tagText } from '@/PhotoTags';
import { close, signInFirst } from '@/nav';
import { HeroMedia } from '@/HeroMedia';
import { ScreenHeader } from '@/ScreenHeader';
import { SoundPlayer } from '@/SoundPlayer';
import { StaticMap } from '@/StaticMap';
import { StatusBadge } from '@/StatusBadge';
import { font, radius, space, useColors } from '@/theme';

const CONFIDENCE = { certain: 'Certain', likely: 'Likely', guess: 'Best guess' } as const;
const pretty = (v: string) => v.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());

/** A single sighting, laid out like design/refs/screen-detail.png. Owners can edit or delete it (OBS-11). */
export default function Sighting() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [o, setO] = useState<Observation | null>(null);
  const [history, setHistory] = useState<Edit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const [photosY, setPhotosY] = useState(0);
  const [mapY, setMapY] = useState(0);
  const token = session?.token;
  const userId = session?.user.id;
  const mine = !!session && o?.observer.id === userId;
  // LIB-08/09: the photo or recording whose tags are being edited
  const [tagging, setTagging] = useState<{ kind: 'photo' | 'sound'; id: number } | null>(null);
  const canTag = mine || isVerifier(session?.user);
  const saveTags = (kind: 'photo' | 'sound', id: number, tags: (PhotoTag | SoundTag)[]) => {
    if (!o) return;
    const before = o;
    setO(
      kind === 'photo'
        ? { ...o, photos: o.photos.map((x) => (x.id === id ? { ...x, tags: tags as PhotoTag[] } : x)) }
        : { ...o, sounds: o.sounds.map((x) => (x.id === id ? { ...x, tags: tags as SoundTag[] } : x)) },
    );
    setPhotoTags(session!.token, `${kind}:${id}`, tags).catch((e) => {
      setO(before);
      Alert.alert('Couldn’t save the tags', e instanceof Error ? e.message : String(e));
    });
  };

  useFocusEffect(
    useCallback(() => {
      getObservation(Number(id), token)
        .then((obs) => {
          setO(obs);
          if (token && obs.observer.id === userId) {
            observationHistory(token, obs.id)
              .then((h) => setHistory(h.items))
              .catch(() => {});
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, [id, token, userId]),
  );

  const menu = () =>
    Alert.alert('This sighting', undefined, [
      { text: 'Edit', onPress: () => router.push({ pathname: '/observe', params: { edit: id } }) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete this sighting?', 'Its photos are deleted too. This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () =>
                deleteObservation(session!.token, Number(id))
                  .then(close)
                  .catch((e) => Alert.alert('Couldn’t delete', e instanceof Error ? e.message : String(e))),
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const shown = o ? shownSpecies(o) : null;
  const name = shown?.english_name ?? 'Unknown bird';

  // VER-05: anyone signed in (other than the observer) can report a sighting.
  const reportPerson = () => {
    const send = (reason: UserReportReason) =>
      reportUser(session!.token, o!.observer.id, reason)
        .then(() => Alert.alert('Thanks', 'A moderator will take a look.'))
        .catch((e) => Alert.alert('Couldn’t report', e instanceof Error ? e.message : String(e)));
    Alert.alert(`Report ${o!.observer.display_name}`, 'What’s going on?', [
      { text: 'Spam', onPress: () => send('spam') },
      { text: 'Harassment', onPress: () => send('harassment') },
      { text: 'Pretending to be someone', onPress: () => send('impersonation') },
      { text: 'Something else', onPress: () => send('other') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const block = () =>
    Alert.alert(`Block ${o!.observer.display_name}?`, 'You won’t see each other’s sightings or IDs. You can unblock from your profile.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          blockUser(session!.token, o!.observer.id)
            .then(close)
            .catch((e) => Alert.alert('Couldn’t block', e instanceof Error ? e.message : String(e))),
      },
    ]);

  const moderate = (action: 'hide' | 'restore') =>
    moderateSighting(session!.token, o!.id, action)
      .then(() => {
        setO({ ...o!, hidden: action === 'hide' });
        Alert.alert(action === 'hide' ? 'Sighting hidden' : 'Sighting restored');
      })
      .catch((e) => Alert.alert('Couldn’t do that', e instanceof Error ? e.message : String(e)));

  // Someone else's sighting: report it, report the person, or block them (COM-05); moderators can hide it (ADM-01).
  const othersMenu = () =>
    Alert.alert(o!.observer.display_name, undefined, [
      ...(isModerator(session?.user)
        ? [o!.hidden ? { text: 'Restore (moderator)', onPress: () => moderate('restore') } : { text: 'Hide (moderator)', onPress: () => moderate('hide') }]
        : []),
      { text: 'Report this sighting', onPress: report },
      { text: `Report ${o!.observer.display_name}`, onPress: reportPerson },
      { text: `Block ${o!.observer.display_name}`, style: 'destructive', onPress: block },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const report = () => {
    const send = (reason: FlagReason) =>
      flagObservation(session!.token, Number(id), reason)
        .then(() => Alert.alert('Thanks', 'A moderator will take a look.'))
        .catch((e) => Alert.alert('Couldn’t report', e instanceof Error ? e.message : String(e)));
    Alert.alert('Report this sighting', 'What’s wrong?', [
      { text: 'Wrong ID', onPress: () => send('wrong_id') },
      { text: 'Captive or escaped bird', onPress: () => send('captive') },
      { text: 'Poor quality', onPress: () => send('poor_quality') },
      { text: 'Inappropriate', onPress: () => send('inappropriate') },
      { text: 'Reveals a sensitive location', onPress: () => send('sensitive_location') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const hero = o?.photos[0]?.url ?? o?.species?.thumb_url ?? null; // species photo only for the observer's own ID
  const when = o ? new Date(o.observed_at) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader
        title={o ? name : ''}
        back
        right={
          o ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
              {!o.hidden && (
                <Pressable onPress={() => shareSighting(o.id, name)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Share a link">
                  <Feather name="share-2" size={22} color={c.ink} />
                </Pressable>
              )}
              <Pressable
                onPress={
                  mine ? menu : session ? othersMenu : () => signInFirst('Sign in to report this sighting or block someone.')
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={mine ? 'Edit or delete' : 'Report or block'}
              >
                <Feather name="more-horizontal" size={24} color={c.ink} />
              </Pressable>
            </View>
          ) : undefined
        }
      />
      {!o ? (
        <View style={styles.center}>
          {error ? (
            <Text style={[styles.body, { color: c.wrong }]}>Couldn’t load this sighting.</Text>
          ) : (
            <ActivityIndicator color={c.accent} />
          )}
        </View>
      ) : (
        <FormScroll ref={scroll} contentContainerStyle={{ paddingBottom: space.xxl * 2 }}>
          <HeroMedia
            id={shown?.id ?? o.id}
            uri={hero ? mediaUrl(hero) : null}
            chips={[
              { needs_id: 'Needs ID', community: 'Community ID', verified: '✓ Verified' }[o.status],
              ...(o.photos.some((p) => p.reference) ? ['★ Reference photo'] : []),
            ]}
            actions={[
              ...(shown ? [{ icon: 'info' as const, label: 'Species', onPress: () => router.push(`/species/${shown.id}`) }] : []),
              { icon: 'map' as const, label: 'Map', onPress: () => scroll.current?.scrollTo({ y: mapY, animated: true }) },
              {
                icon: 'image' as const,
                label: 'Photos',
                count: o.photos.length,
                onPress: () =>
                  o.photos.length
                    ? scroll.current?.scrollTo({ y: photosY, animated: true })
                    : Alert.alert('No photos', mine ? 'Edit this sighting to add photos.' : 'This sighting has no photos.'),
              },
            ]}
          />

          <View style={styles.text}>
            <Text style={[styles.name, { color: c.ink }]} accessibilityRole="header">
              {name}
            </Text>
            {shown && <Text style={[styles.sci, { color: c.inkMuted }]}>{shown.scientific_name}</Text>}
            <View style={{ marginTop: space.m }}>
              <StatusBadge status={o.status} />
            </View>
            {o.hidden && (
              <View style={styles.hiddenNote} accessibilityRole="alert">
                <Text style={[styles.body, { color: c.ink }]}>
                  {mine
                    ? 'A moderator has hidden this sighting. Only you can see it. Check the community guidelines, or edit it.'
                    : 'Hidden by a moderator. Only its observer and moderators can see it.'}
                </Text>
              </View>
            )}
            {!!o.unusual && o.status !== 'verified' && (
              <View style={styles.hiddenNote} accessibilityRole="alert">
                <Text style={[styles.body, { color: c.ink }]}>
                  {o.unusual === 'range'
                    ? 'Unusual: this bird hasn’t been recorded in Sierra Leone before. It waits for an expert to confirm.'
                    : 'Unusual: this bird isn’t normally seen in Sierra Leone at this time of year. It waits for an expert to confirm.'}
                </Text>
              </View>
            )}

            <View style={styles.facts}>
              <Fact label="When" value={when!.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} />
              <Fact label="How many" value={String(o.count)} />
              {!!o.confidence && <Fact label="ID confidence" value={CONFIDENCE[o.confidence]} />}
              <Fact
                label="Where"
                value={
                  o.obscured
                    ? 'Hidden to protect this species'
                    : `${o.site ? `${o.site.name} · ` : ''}${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}`
                }
              />
              {!mine && <Fact label="Seen by" value={o.observer.display_name} />}
            </View>
            <View style={styles.social}>
              <Pressable
                onPress={() => {
                  if (!session) return signInFirst('Sign in to like sightings.');
                  const on = !o.liked;
                  setO({ ...o, liked: on, likes: o.likes + (on ? 1 : -1) }); // show it now; the server's count follows
                  likeSighting(session.token, o.id, on).then(
                    (r) => setO((cur) => (cur ? { ...cur, likes: r.likes, liked: r.liked } : cur)),
                    () => setO((cur) => (cur ? { ...cur, liked: !on, likes: cur.likes + (on ? -1 : 1) } : cur)),
                  );
                }}
                style={[styles.like, { backgroundColor: o.liked ? '#FDE8E8' : c.field }]}
                accessibilityRole="button"
                accessibilityState={{ selected: o.liked }}
                accessibilityLabel={`${o.liked ? 'Unlike' : 'Like'}. ${o.likes} like${o.likes === 1 ? '' : 's'}`}
              >
                <Feather name="heart" size={16} color={o.liked ? c.wrong : c.ink} />
                <Text style={[styles.likeText, { color: c.ink }]}>{o.likes || 'Like'}</Text>
              </Pressable>
              {!mine && session && <FollowButton token={session.token} userId={o.observer.id} name={o.observer.display_name} />}
            </View>

            {o.sounds.length > 0 && (
              <>
                <Text style={[styles.h2, { color: c.ink }]}>Calls and songs</Text>
                <View style={{ gap: space.m }}>
                  {o.sounds.map((snd) => (
                    <View key={snd.id} style={{ gap: 2 }}>
                      <SoundPlayer
                        sound={snd}
                        caption={[tagText(snd.tags ?? []), LICENCES.find((l) => l.value === snd.licence)?.label].filter(Boolean).join(' · ')}
                      />
                      {canTag && (
                        <Pressable
                          onPress={() => setTagging({ kind: 'sound', id: snd.id })}
                          accessibilityRole="button"
                          accessibilityLabel="Tag what this recording holds"
                        >
                          <Text style={[styles.caption, { color: c.accentDeep, marginLeft: space.s }]}>
                            <Feather name="tag" size={11} /> {snd.tags?.length ? 'Edit tags' : 'Tag: song, call, alarm…'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              </>
            )}

            <View onLayout={(e) => setMapY(e.nativeEvent.layout.y + 368)}>
              <Text style={[styles.h2, { color: c.ink }]}>Where it was seen</Text>
              <StaticMap
                pin={{ lat: o.lat, lng: o.lng }}
                zoom={o.obscured ? 8 : 13}
                title={`Where the ${name} was seen`}
                label={o.obscured ? 'Map of the general area of this sighting' : 'Map of where this sighting was made'}
              />
              {o.obscured && (
                <Text style={[styles.caption, { color: c.inkFaint }]}>
                  Only the general area is shown, to protect this species.
                </Text>
              )}
            </View>

            <CommunityId o={o} onChange={setO} />
            <Comments observationId={o.id} />

            {Object.keys(o.features).length > 0 && (
              <>
                <Text style={[styles.h2, { color: c.ink }]}>ID features</Text>
                <View style={styles.chips}>
                  {Object.values(o.features)
                    .flat()
                    .map((v) => (
                      <View key={v} style={[styles.chip, { backgroundColor: c.tint }]}>
                        <Text style={[styles.chipText, { color: c.ink }]}>{pretty(v)}</Text>
                      </View>
                    ))}
                </View>
              </>
            )}

            {!!o.notes && (
              <>
                <Text style={[styles.h2, { color: c.ink }]}>Notes</Text>
                <Text style={[styles.body, { color: c.inkMuted }]}>{o.notes}</Text>
              </>
            )}

            {o.photos.length > 0 && (
              <>
                <Text
                  style={[styles.h2, { color: c.ink }]}
                  onLayout={(e) => setPhotosY(e.nativeEvent.layout.y + 368)} // + hero height above the text block
                >
                  Photos
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.m }}>
                  {o.photos.map((p) => (
                    <View key={p.id}>
                      <Image source={{ uri: mediaUrl(p.thumb_url) }} style={styles.thumb} />
                      {!!p.tags?.length && (
                        <Text style={[styles.caption, { color: c.ink, width: 120 }]} numberOfLines={2}>
                          {tagText(p.tags)}
                        </Text>
                      )}
                      <Text style={[styles.caption, { color: c.inkFaint }]}>
                        {LICENCES.find((l) => l.value === p.licence)?.label}
                      </Text>
                      {canTag && (
                        <Pressable onPress={() => setTagging({ kind: 'photo', id: p.id })} accessibilityRole="button" accessibilityLabel="Tag what this photo shows">
                          <Text style={[styles.caption, { color: c.accentDeep }]}>
                            <Feather name="tag" size={11} /> {p.tags?.length ? 'Edit tags' : 'Tag photo'}
                          </Text>
                        </Pressable>
                      )}
                      {isVerifier(session?.user) && (
                        <Pressable
                          onPress={() =>
                            setQuizSuitable(session!.token, `photo:${p.id}`, !p.quiz_suitable).then(() =>
                              setO({ ...o, photos: o.photos.map((x) => (x.id === p.id ? { ...x, quiz_suitable: !x.quiz_suitable } : x)) }),
                            )
                          }
                          accessibilityRole="button"
                        >
                          <Text style={[styles.caption, { color: p.quiz_suitable ? c.wrong : c.accentDeep }]}>
                            {p.quiz_suitable ? 'Hide from quizzes' : 'Allow in quizzes'}
                          </Text>
                        </Pressable>
                      )}
                      {isVerifier(session?.user) && o.status === 'verified' && (
                        <Pressable
                          onPress={() =>
                            setReference(session!.token, `photo:${p.id}`, !p.reference).then(() =>
                              setO({ ...o, photos: o.photos.map((x) => (x.id === p.id ? { ...x, reference: !x.reference } : x)) }),
                            )
                          }
                          accessibilityRole="button"
                        >
                          <Text style={[styles.caption, { color: c.accentDeep }]}>
                            {p.reference ? '★ Reference · unmark' : '☆ Mark as reference'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            {mine && history.length > 0 && (
              <>
                <Text style={[styles.h2, { color: c.ink }]}>Edit history</Text>
                {history
                  .slice()
                  .reverse()
                  .map((e) => (
                    <Text key={e.edited_at} style={[styles.body, { color: c.inkMuted }]}>
                      {new Date(e.edited_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                      changed {Object.keys(e.changes).map((k) => pretty(k.replace('_id', ''))).join(', ').toLowerCase()}
                    </Text>
                  ))}
              </>
            )}
          </View>
        </FormScroll>
      )}
      <Modal visible={tagging !== null} transparent animationType="slide" onRequestClose={() => setTagging(null)}>
        <Pressable style={styles.scrim} onPress={() => setTagging(null)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: c.bg }]}>
          <Text style={[styles.h2, { color: c.ink }]}>
            {tagging?.kind === 'sound' ? 'What does this recording hold?' : 'What does this photo show?'}
          </Text>
          <Text style={[styles.caption, { color: c.inkMuted, marginBottom: space.m }]}>
            {tagging?.kind === 'sound'
              ? 'Tags help others learn songs apart from calls and alarms.'
              : 'Tags help others find males, females, young birds and seasonal plumage.'}
          </Text>
          {tagging?.kind === 'sound' ? (
            <TagEditor
              options={SOUND_TAGS}
              tags={o?.sounds.find((x) => x.id === tagging.id)?.tags ?? []}
              onChange={(t) => saveTags('sound', tagging.id, t)}
            />
          ) : (
            <TagEditor
              tags={o?.photos.find((x) => x.id === tagging?.id)?.tags ?? []}
              onChange={(t) => tagging && saveTags('photo', tagging.id, t)}
            />
          )}
          <Pressable style={[styles.done, { backgroundColor: c.primary }]} onPress={() => setTagging(null)} accessibilityRole="button">
            <Text style={[styles.doneText, { color: c.onPrimary }]}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: c.inkFaint }]}>{label}</Text>
      <Text style={[styles.factValue, { color: c.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  social: { flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' },
  like: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.l, height: 38 },
  likeText: { fontFamily: font.semibold, fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  hiddenNote: { backgroundColor: '#FFF6DD', borderRadius: radius.tile, padding: space.l, marginTop: space.m },
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
  art: { position: 'absolute', right: 10, top: 0 },
  actions: { position: 'absolute', left: space.screen + 20, top: 60, gap: space.l },
  text: { paddingHorizontal: space.screen + 8, marginTop: space.xl },
  name: { fontFamily: font.display, fontSize: 44, lineHeight: 46 },
  sci: { fontFamily: font.italic, fontSize: 15, marginTop: space.s },
  facts: { marginTop: space.xl, gap: space.m },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: space.l },
  factLabel: { fontFamily: font.semibold, fontSize: 13 },
  factValue: { fontFamily: font.semibold, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  h2: { fontFamily: font.bold, fontSize: 18, marginTop: space.xl, marginBottom: space.s },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 6 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  thumb: { width: 120, height: 120, borderRadius: radius.tile },
  caption: { fontFamily: font.medium, fontSize: 11, marginTop: 4 },
  scrim: { flex: 1, backgroundColor: 'rgba(11,10,31,0.4)' },
  sheet: { padding: space.screen, paddingBottom: space.xxl, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: space.s },
  done: { borderRadius: radius.pill, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: space.l },
  doneText: { fontFamily: font.semibold, fontSize: 15 },
});

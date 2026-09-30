import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, FlatList, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';

import { Pressable } from '@/components/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addPhotoMark,
  deletePhotoMark,
  isVerifier,
  mediaUrl,
  setPhotoTags,
  setReference,
  type GalleryPhoto,
  type PhotoMark,
  type PhotoTag,
} from '@/api';
import { useAuth } from '@/state/auth';
import { TagEditor, tagText } from '@/components/PhotoTags';
import { font, radius, space, useColors } from '@/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Sierra Leone: rains May–October, dry season November–April.
const season = (m: number | null) => (m === null ? null : m >= 5 && m <= 10 ? 'Rainy season' : 'Dry season');

function caption(p: GalleryPhoto) {
  const when = p.month ? `${season(p.month)} (${MONTHS[p.month - 1]})` : '';
  return [tagText(p.tags), when].filter(Boolean).join(' · ');
}

type Filter = { label: string; test: (p: GalleryPhoto) => boolean };
const FILTERS: Filter[] = [
  { label: 'All', test: () => true },
  { label: 'Male', test: (p) => p.tags.includes('male') },
  { label: 'Female', test: (p) => p.tags.includes('female') },
  { label: 'Young', test: (p) => p.tags.includes('juvenile') },
  { label: 'Breeding', test: (p) => p.tags.includes('breeding') },
  { label: 'Non-breeding', test: (p) => p.tags.includes('non-breeding') },
  { label: 'In flight', test: (p) => p.tags.includes('in-flight') },
  { label: 'Rainy season', test: (p) => season(p.month) === 'Rainy season' },
  { label: 'Dry season', test: (p) => season(p.month) === 'Dry season' },
];

/** LIB-08: species reference photos, filterable by sex, age, plumage, flight and season; tap for a full-screen, swipeable view. */
export function Gallery({ photos: given }: { photos: GalleryPhoto[] }) {
  const { session } = useAuth();
  const [refs, setRefs] = useState<Record<number, boolean>>({}); // reference marks changed on this screen (VER-07)
  const [tagged, setTagged] = useState<Record<number, PhotoTag[]>>({}); // tags changed on this screen
  const [marked, setMarked] = useState<Record<number, PhotoMark[]>>({}); // field marks changed on this screen (LRN-03)
  const photos = given.map((p) => ({
    ...p,
    reference: refs[p.id] ?? p.reference,
    tags: tagged[p.id] ?? p.tags ?? [],
    marks: marked[p.id] ?? p.marks ?? [],
  }));
  const c = useColors();
  const [filter, setFilter] = useState(FILTERS[0]);
  const [open, setOpen] = useState<number | null>(null);
  const shown = photos.filter(filter.test);
  const filters = FILTERS.filter((f) => f === FILTERS[0] || photos.some(f.test));

  return (
    <View style={{ gap: space.m }}>
      {filters.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
          {filters.map((f) => {
            const on = f === filter;
            return (
              <Pressable
                key={f.label}
                onPress={() => setFilter(f)}
                style={[styles.chip, { backgroundColor: on ? c.accent : c.field }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, { color: on ? c.onAccent : c.ink }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.m }}>
        {shown.map((p, i) => (
          <Pressable key={p.url} onPress={() => setOpen(i)} accessibilityRole="imagebutton" accessibilityLabel={caption(p) || 'Photo'}>
            <Image source={{ uri: mediaUrl(p.thumb_url) }} style={styles.thumb} />
            <Text style={[styles.caption, { color: c.ink }]} numberOfLines={1}>
              {p.reference ? '★ ' : ''}
              {caption(p) || (p.reference ? 'Reference' : ' ')}
            </Text>
            <Text style={[styles.credit, { color: c.inkFaint }]} numberOfLines={1}>
              {p.credit} · {p.licence}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Viewer
        photos={shown}
        index={open}
        onClose={() => setOpen(null)}
        verifier={isVerifier(session?.user)}
        token={session?.token}
        onReference={(id, on) => setRefs({ ...refs, [id]: on })}
        onTags={(id, t) => setTagged({ ...tagged, [id]: t })}
        onMarks={(id, m) => setMarked({ ...marked, [id]: m })}
      />
    </View>
  );
}

function Viewer({
  photos,
  index,
  onClose,
  verifier,
  token,
  onReference,
  onTags,
  onMarks,
}: {
  photos: GalleryPhoto[];
  index: number | null;
  onClose: () => void;
  verifier: boolean;
  token?: string;
  onReference: (id: number, on: boolean) => void;
  onTags: (id: number, tags: PhotoTag[]) => void;
  onMarks: (id: number, marks: PhotoMark[]) => void;
}) {
  const { width } = useWindowDimensions();
  const [showMarks, setShowMarks] = useState(true);
  const [placing, setPlacing] = useState<number | null>(null); // photo a verifier is adding a mark to
  const [draft, setDraft] = useState<{ photo: GalleryPhoto; x: number; y: number; label: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const saveMark = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const m = await addPhotoMark(token!, `gallery:${draft.photo.id}`, draft.x, draft.y, draft.label.trim());
      onMarks(draft.photo.id, [...(draft.photo.marks ?? []), m]);
      setDraft(null);
      setPlacing(null);
    } catch (e) {
      Alert.alert('Couldn’t add the mark', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const removeMark = (p: GalleryPhoto, m: PhotoMark) =>
    Alert.alert(`Remove “${m.label}”?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          deletePhotoMark(token!, m.id).then(
            () =>
              onMarks(
                p.id,
                (p.marks ?? []).filter((x) => x.id !== m.id),
              ),
            () => {},
          ),
      },
    ]);
  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.viewer}>
        <Pressable onPress={onClose} style={styles.close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Feather name="x" size={26} color="#FFFFFF" />
        </Pressable>
        {index !== null && (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p) => p.url}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: p }) => {
              const h = (width * p.height) / p.width;
              const marks = p.marks ?? [];
              return (
                <View style={{ width, flex: 1, justifyContent: 'center' }}>
                  <Pressable
                    disabled={placing !== p.id}
                    onPress={(e) =>
                      setDraft({ photo: p, x: e.nativeEvent.locationX / width, y: e.nativeEvent.locationY / h, label: draft?.label ?? '' })
                    }
                    accessibilityLabel={placing === p.id ? 'Tap where the field mark is' : undefined}
                  >
                    <Image source={{ uri: mediaUrl(p.url) }} style={{ width, height: h }} contentFit="contain" />
                    {showMarks &&
                      marks.map((m) => (
                        <Pressable
                          key={m.id}
                          disabled={!verifier || placing !== null}
                          onPress={() => removeMark(p, m)}
                          style={[styles.mark, { left: m.x * width - 7, top: m.y * h - 7 }]}
                          accessibilityLabel={`Field mark: ${m.label}`}
                        >
                          <View style={styles.dot} />
                          <Text style={styles.markLabel}>{m.label}</Text>
                        </Pressable>
                      ))}
                    {draft && draft.photo.id === p.id && (
                      <View style={[styles.mark, { left: draft.x * width - 7, top: draft.y * h - 7 }]} pointerEvents="none">
                        <View style={[styles.dot, { backgroundColor: '#F4B400' }]} />
                      </View>
                    )}
                  </Pressable>
                  <View style={styles.meta}>
                    {marks.length > 0 && placing === null && (
                      <Pressable onPress={() => setShowMarks(!showMarks)} accessibilityRole="button">
                        <Text style={[styles.metaCredit, { color: '#FFFFFF' }]}>
                          {showMarks ? `Hide field marks (${marks.length})` : `Show field marks (${marks.length})`}
                        </Text>
                      </Pressable>
                    )}
                    {verifier && p.reference && placing === null && marks.length < 8 && (
                      <Pressable
                        onPress={() => {
                          setPlacing(p.id);
                          setShowMarks(true);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.metaCredit, { color: '#FFFFFF' }]}>＋ Add a field mark</Text>
                      </Pressable>
                    )}
                    {!!caption(p) && <Text style={styles.metaTitle}>{caption(p)}</Text>}
                    <Pressable onPress={() => Linking.openURL(p.source_url)} accessibilityRole="link">
                      <Text style={styles.metaCredit}>
                        Photo: {p.credit} · {p.licence} · iNaturalist
                      </Text>
                    </Pressable>
                    {verifier && (
                      <Pressable
                        onPress={() => setReference(token!, `gallery:${p.id}`, !p.reference).then(() => onReference(p.id, !p.reference))}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.metaCredit, { color: '#FFFFFF' }]}>
                          {p.reference ? '★ Reference photo · unmark' : '☆ Mark as reference photo'}
                        </Text>
                      </Pressable>
                    )}
                    {verifier && (
                      <View style={{ marginTop: space.s }}>
                        <TagEditor
                          dark
                          tags={p.tags}
                          onChange={(t) => {
                            onTags(p.id, t); // show it now; put it back if the server says no
                            setPhotoTags(token!, `gallery:${p.id}`, t).catch(() => onTags(p.id, p.tags));
                          }}
                        />
                      </View>
                    )}
                  </View>
                </View>
              );
            }}
          />
        )}
        {placing !== null && (
          // at the top, so the keyboard never covers it
          <View style={styles.markBar}>
            {!draft ? (
              <Text style={styles.metaTitle}>Tap the photo where the field mark is</Text>
            ) : (
              <TextInput
                style={styles.markInput}
                value={draft.label}
                onChangeText={(label) => setDraft({ ...draft, label })}
                placeholder="What to look for, e.g. white eye-ring"
                placeholderTextColor="#9C98C2"
                maxLength={40}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveMark}
              />
            )}
            <View style={styles.markActions}>
              <Pressable
                onPress={() => {
                  setPlacing(null);
                  setDraft(null);
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.metaCredit, { color: '#FFFFFF' }]}>Cancel</Text>
              </Pressable>
              {draft && (
                <Pressable onPress={saveMark} disabled={saving || draft.label.trim().length < 2} accessibilityRole="button">
                  <Text style={[styles.metaTitle, (saving || draft.label.trim().length < 2) && { opacity: 0.4 }]}>
                    {saving ? 'Saving…' : 'Save mark'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  thumb: { width: 150, height: 150, borderRadius: radius.tile },
  caption: { fontFamily: font.semibold, fontSize: 12, marginTop: 6, width: 150 },
  credit: { fontFamily: font.medium, fontSize: 11, width: 150 },
  viewer: { flex: 1, backgroundColor: '#0B0A1F' },
  close: { position: 'absolute', top: 56, right: space.screen, zIndex: 2 },
  meta: { paddingHorizontal: space.screen, marginTop: space.l, gap: 4 },
  metaTitle: { fontFamily: font.bold, fontSize: 16, color: '#FFFFFF' },
  metaCredit: { fontFamily: font.medium, fontSize: 12, color: '#C9C8D6' },
  mark: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: '#7B6FF0' },
  markLabel: {
    fontFamily: font.bold,
    fontSize: 11,
    color: '#17144B',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  markBar: {
    position: 'absolute',
    top: 96,
    left: space.screen,
    right: space.screen,
    backgroundColor: '#17144B',
    borderRadius: radius.card,
    padding: space.m,
    gap: space.s,
  },
  markInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.tile,
    paddingHorizontal: space.m,
    height: 44,
    fontFamily: font.regular,
    fontSize: 15,
    color: '#17144B',
  },
  markActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

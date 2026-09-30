import { Feather } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';

import { FormScroll } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';

import {
  addPhoto,
  addSound,
  createSite,
  deletePhoto,
  deleteSound,
  getObservation,
  mediaUrl,
  nearbySites,
  speciesLikely,
  updateObservation,
  type Confidence,
  type Features,
  type Photo,
  type Site,
  type Sound,
} from '@/api';
import { useAuth } from '@/state/auth';
import { close } from '@/lib/nav';
import { enqueue, syncOutbox } from '@/state/outbox';
import { activeOuting, noteSighting, useOutingState } from '@/state/outing';
import { exifDate, exifLocation } from '@/lib/exif';
import { FeaturePicker } from '@/components/FeaturePicker';
import { Guidelines } from '@/components/Guidelines';
import { shrink } from '@/lib/images';
import { LICENCES, type Licence } from '@/lib/licences';
import { MapPicker } from '@/components/MapPicker';
import { SoundRecorder, type PendingSound } from '@/components/SoundRecorder';
import { SpeciesPicker, type Picked } from '@/components/SpeciesPicker';
import { font, radius, space, useColors, type Colors } from '@/theme';

type Fix = { lat: number; lng: number; accuracy: number | null; fromPhoto?: boolean; fromMap?: boolean };

const MAX_PHOTOS = 10;

/** Current GPS fix, or an error message to show. */
async function getFix(): Promise<Fix | string> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return 'Location permission is needed to record where you saw the bird.';
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * OBS-01/02/11: record a sighting with photos, or edit one (`?edit=<id>`).
 * With sounds (OBS-03) and map pin / named sites (OBS-04). Offline (OBS-09) comes later.
 */
export default function Observe() {
  const c = useColors();
  const s = styles(c);
  const { session } = useAuth();
  // Opened from a species page ("I saw this bird") → species is preselected.
  const params = useLocalSearchParams<{ speciesId?: string; name?: string; sci?: string; edit?: string }>();
  const editId = params.edit ? Number(params.edit) : null;
  const [species, setSpecies] = useState<Picked>(
    params.speciesId && params.name
      ? { id: Number(params.speciesId), english_name: params.name, scientific_name: params.sci ?? '' }
      : undefined,
  );
  const [when, setWhen] = useState(() => new Date());
  const [fix, setFix] = useState<Fix | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(true);
  const [count, setCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [features, setFeatures] = useState<Features>({});
  // VER-08: warn (not block) when the bird is unlikely for this place or month
  const [unusual, setUnusual] = useState<{ key: string; kind: '' | 'range' | 'season' } | null>(null);
  const likelyKey = species && fix ? `${species.id}:${fix.lat.toFixed(2)}:${fix.lng.toFixed(2)}:${when.getMonth()}` : '';
  useEffect(() => {
    if (!species || !fix) return;
    const key = `${species.id}:${fix.lat.toFixed(2)}:${fix.lng.toFixed(2)}:${when.getMonth()}`;
    speciesLikely(species.id, fix.lat, fix.lng, when).then((r) => setUnusual({ key, kind: r.unusual }), () => {});
  }, [species, fix, when]);
  const warn = unusual && unusual.key === likelyKey ? unusual.kind : '';
  const [confidence, setConfidence] = useState<Confidence>('likely');
  const [licence, setLicence] = useState<Licence>(session?.user.default_licence ?? 'cc-by-nc');
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]); // new, not uploaded yet
  const [existing, setExisting] = useState<Photo[]>([]); // edit mode: already uploaded
  const [removed, setRemoved] = useState<number[]>([]); // edit mode: existing photos to delete on save
  const [sounds, setSounds] = useState<PendingSound[]>([]); // new, trimmed, not uploaded yet
  const [existingSounds, setExistingSounds] = useState<Sound[]>([]);
  const [removedSounds, setRemovedSounds] = useState<number[]>([]);
  const [recording, setRecording] = useState(false); // sound recorder panel open
  const [showMap, setShowMap] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  const [siteName, setSiteName] = useState('');
  const [whenFromPhoto, setWhenFromPhoto] = useState(false);
  const outingState = useOutingState();
  const onOuting = !editId && !!outingState.active; // OBS-10
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // progress label while saving
  const [error, setError] = useState<string | null>(null);

  function apply(result: Fix | string) {
    if (typeof result === 'string') setLocError(result);
    else {
      setFix((prev) => (prev?.fromPhoto || prev?.fromMap ? prev : result)); // a photo or map pin beats a late GPS fix
      setLocError(null);
    }
    setLocating(false);
  }

  useEffect(() => {
    if (!editId) {
      getFix().then(apply);
      return;
    }
    getObservation(editId, session?.token)
      .then((o) => {
        setSpecies(o.species ?? null);
        setWhen(new Date(o.observed_at));
        setFix({ lat: o.lat, lng: o.lng, accuracy: o.accuracy_m });
        setCount(o.count);
        setNotes(o.notes);
        setFeatures(o.features);
        if (o.confidence) setConfidence(o.confidence);
        setExisting(o.photos);
        setExistingSounds(o.sounds);
        setSiteId(o.site?.id ?? null);
        setLocating(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [editId, session?.token]);

  // OBS-04: named sites near the chosen spot (debounced while the pin moves).
  const fixKey = fix ? `${fix.lat.toFixed(4)},${fix.lng.toFixed(4)}` : '';
  useEffect(() => {
    if (!fixKey) return;
    const [lat, lng] = fixKey.split(',').map(Number);
    const t = setTimeout(() => {
      nearbySites(lat, lng)
        .then((r) => {
          setSites(r.items);
          setSiteId((cur) => (cur && r.items.some((x) => x.id === cur) ? cur : null));
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [fixKey]);

  async function saveSite() {
    if (!fix || !session) return;
    try {
      const st = await createSite(session.token, siteName.trim(), fix.lat, fix.lng);
      setSites((prev) => [st, ...prev.filter((x) => x.id !== st.id)]);
      setSiteId(st.id);
      setNaming(false);
      setSiteName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function locate() {
    setLocating(true);
    setFix((prev) => (prev?.fromPhoto || prev?.fromMap ? null : prev)); // Refresh means "use where I am now"
    getFix().then(apply);
  }

  async function pickPhotos(from: 'camera' | 'library') {
    const perm =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(`Allow ${from === 'camera' ? 'camera' : 'photo'} access in Settings to add photos.`);
      return;
    }
    const left = MAX_PHOTOS - photos.length - existing.length + removed.length;
    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: true, quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            exif: true,
            quality: 1,
            allowsMultipleSelection: true,
            selectionLimit: left,
          });
    if (result.canceled) return;
    const picked = result.assets.slice(0, left);
    setPhotos((prev) => [...prev, ...picked]);

    // Gallery photos carry where and when they were taken; use the first one that has it.
    if (from === 'library' && photos.length === 0 && !editId) {
      const loc = picked.map((a) => exifLocation(a.exif)).find(Boolean);
      if (loc) {
        setFix({ ...loc, accuracy: null, fromPhoto: true });
        setLocError(null);
      }
      const date = picked.map((a) => exifDate(a.exif)).find((d) => d && d <= new Date());
      if (date) {
        setWhen(date);
        setWhenFromPhoto(true);
      }
    }
  }

  const addPhotos = () =>
    Alert.alert('Add photos', undefined, [
      { text: 'Take photo', onPress: () => pickPhotos('camera') },
      { text: 'Choose from library', onPress: () => pickPhotos('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  if (!session) return <Redirect href="/sign-in" />;
  // COM-06: the first upload waits for the community guidelines.
  if (!session.user.guidelines_accepted) {
    return (
      <View style={s.screen}>
        <Guidelines onAccepted={() => {}} />
      </View>
    );
  }

  function pickAndroid() {
    DateTimePickerAndroid.open({
      value: when,
      mode: 'date',
      maximumDate: new Date(),
      onValueChange: (_, date) => {
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          onValueChange: (_e, time) => {
            setWhen(time > new Date() ? new Date() : time);
            setWhenFromPhoto(false);
          },
        });
      },
    });
  }

  async function save(another = false) {
    if (!fix || species === undefined) return;
    setSaving('Saving…');
    setError(null);
    try {
      const input = {
        species_id: species?.id ?? null,
        observed_at: when.toISOString(),
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy,
        count,
        notes: notes.trim(),
        features,
        confidence: species ? confidence : ('' as const),
        site_id: siteId,
      };
      if (!editId) {
        // OBS-09: saved on the phone first, then uploaded (now, or when there's signal again).
        setSaving('Saving…');
        const shrunk = [];
        for (const p of photos) shrunk.push(await shrink(p, 2048));
        const outing = activeOuting(); // OBS-10: logged on the outing in progress
        await enqueue(session!.user.id, species?.english_name ?? 'Unknown bird', input, shrunk, sounds, licence, outing?.clientId);
        if (outing) noteSighting();
        void syncOutbox(session!.token, session!.user.id);
        if (another) {
          // Quick logging on an outing: clear the bird, keep going from where you are now.
          setSpecies(undefined);
          setCount(1);
          setNotes('');
          setFeatures({});
          setPhotos([]);
          setSounds([]);
          setWhen(new Date());
          setWhenFromPhoto(false);
          locate();
          setJustSaved(species?.english_name ?? 'Unknown bird');
          return;
        }
        close();
        router.navigate('/sightings');
        return;
      }
      const obs = await updateObservation(session!.token, editId, input);
      for (const pid of removed) await deletePhoto(session!.token, obs.id, pid);
      for (const sid of removedSounds) await deleteSound(session!.token, obs.id, sid);
      // ponytail: when editing, failed new photos are reported, not queued (new sightings go through the outbox).
      let failed = 0;
      for (const [i, p] of photos.entries()) {
        setSaving(`Uploading photo ${i + 1} of ${photos.length}…`);
        try {
          await addPhoto(session!.token, obs.id, await shrink(p, 2048), licence);
        } catch {
          failed++;
        }
      }
      for (const [i, snd] of sounds.entries()) {
        setSaving(`Uploading sound ${i + 1} of ${sounds.length}…`);
        try {
          await addSound(session!.token, obs.id, snd, licence);
        } catch {
          failed++;
        }
      }
      if (failed) Alert.alert('Sighting saved', `${failed} file${failed > 1 ? 's' : ''} couldn't be uploaded.`);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const ready = fix !== null && species !== undefined && saving === null;

  return (
    <View style={s.screen}>
      <FormScroll contentContainerStyle={s.content}>
        <Text style={s.title} accessibilityRole="header">
          {editId ? 'Edit sighting' : 'What did you see?'}
        </Text>
        {onOuting && (
          <View style={s.outingPill}>
            <Feather name="navigation" size={12} color={c.tintIcon} />
            <Text style={s.outingText}>{justSaved ? `Saved ${justSaved}. Next bird?` : 'On your outing'}</Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photos}>
          {existing
            .filter((p) => !removed.includes(p.id))
            .map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setRemoved([...removed, p.id])}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <Image source={{ uri: mediaUrl(p.thumb_url) }} style={s.photo} />
                <View style={s.remove}>
                  <Text style={s.removeText}>×</Text>
                </View>
              </Pressable>
            ))}
          {photos.map((p, i) => (
            <Pressable
              key={p.uri}
              onPress={() => setPhotos(photos.filter((_, j) => j !== i))}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
            >
              <Image source={{ uri: p.uri }} style={s.photo} />
              <View style={s.remove}>
                <Text style={s.removeText}>×</Text>
              </View>
            </Pressable>
          ))}
          {photos.length + existing.length - removed.length < MAX_PHOTOS && (
            <Pressable style={[s.photo, s.addPhoto]} onPress={addPhotos} accessibilityRole="button">
              <Text style={s.addPlus}>+</Text>
              <Text style={s.addText}>{photos.length || existing.length ? 'More' : 'Add photos'}</Text>
            </Pressable>
          )}
        </ScrollView>

        {existingSounds
          .filter((snd) => !removedSounds.includes(snd.id))
          .map((snd) => (
            <View key={snd.id} style={s.soundRow}>
              <Image source={{ uri: mediaUrl(snd.spectrogram_url) }} style={s.soundThumb} contentFit="fill" />
              <Text style={s.soundText}>{snd.duration_s.toFixed(1)} s</Text>
              <Pressable onPress={() => setRemovedSounds([...removedSounds, snd.id])} hitSlop={10} accessibilityLabel="Remove sound">
                <Text style={s.link}>Remove</Text>
              </Pressable>
            </View>
          ))}
        {sounds.map((snd, i) => (
          <View key={snd.uri + i} style={s.soundRow}>
            {snd.spectrogram ? (
              <Image source={{ uri: snd.spectrogram }} style={s.soundThumb} contentFit="fill" />
            ) : (
              <View style={[s.soundThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: c.tint }]}>
                <Feather name="mic" size={18} color={c.tintIcon} />
              </View>
            )}
            <Text style={s.soundText}>
              {(snd.end - snd.start).toFixed(1)} s{snd.spectrogram ? '' : ' · recorded offline, kept whole'}
            </Text>
            <Pressable onPress={() => setSounds(sounds.filter((_, j) => j !== i))} hitSlop={10} accessibilityLabel="Remove sound">
              <Text style={s.link}>Remove</Text>
            </Pressable>
          </View>
        ))}
        {recording ? (
          <SoundRecorder
            onAdd={(snd) => {
              setSounds([...sounds, snd]);
              setRecording(false);
            }}
            onCancel={() => setRecording(false)}
          />
        ) : (
          sounds.length + existingSounds.length - removedSounds.length < 5 && (
            <Pressable style={s.addSound} onPress={() => setRecording(true)} accessibilityRole="button">
              <Text style={s.addText}>+ Add a call or song</Text>
            </Pressable>
          )
        )}

        {(photos.length > 0 || sounds.length > 0) && (
          <View style={{ gap: space.s, marginBottom: space.m }}>
            <Text style={s.label}>Licence for your photos and sounds · {LICENCES.find((l) => l.value === licence)?.hint}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
              {LICENCES.map((l) => {
                const on = licence === l.value;
                return (
                  <Pressable
                    key={l.value}
                    style={[s.licChip, on && { backgroundColor: c.accent, borderColor: c.accent }]}
                    onPress={() => setLicence(l.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[s.confText, on && { color: c.onAccent }]}>{l.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        <SpeciesPicker value={species} onChange={setSpecies} month={when.getMonth() + 1} />
        {!!warn && species && (
          <View style={s.unusual} accessibilityRole="alert">
            <Feather name="alert-triangle" size={16} color={c.ink} />
            <Text style={s.unusualText}>
              {warn === 'range'
                ? `The ${species.english_name} hasn’t been recorded in Sierra Leone. You can still post it: an expert will check it.`
                : `The ${species.english_name} isn’t usually seen in Sierra Leone in ${when.toLocaleDateString(undefined, { month: 'long' })}. You can still post it: an expert will check it.`}
            </Text>
          </View>
        )}
        {species && (
          <View style={s.confidence} accessibilityRole="radiogroup" accessibilityLabel="How sure are you?">
            {(['certain', 'likely', 'guess'] as const).map((v) => {
              const on = confidence === v;
              return (
                <Pressable
                  key={v}
                  style={[s.confChip, on && { backgroundColor: c.accent, borderColor: c.accent }]}
                  onPress={() => setConfidence(v)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.confText, on && { color: c.onAccent }]}>
                    {v === 'certain' ? 'Certain' : v === 'likely' ? 'Likely' : 'Best guess'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={s.label}>When{whenFromPhoto ? ' · from photo' : ''}</Text>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={when}
            mode="datetime"
            display="compact"
            maximumDate={new Date()}
            onValueChange={(_, d) => {
              setWhen(d);
              setWhenFromPhoto(false);
            }}
            style={{ alignSelf: 'flex-start' }}
          />
        ) : (
          <Pressable style={s.field} onPress={pickAndroid} accessibilityRole="button">
            <Text style={s.fieldText}>{when.toLocaleString()}</Text>
          </Pressable>
        )}

        <Text style={s.label}>Where{fix?.fromPhoto ? ' · from photo' : fix?.fromMap ? ' · set on map' : ''}</Text>
        <View style={s.field}>
          {locating ? (
            <ActivityIndicator color={c.ink} />
          ) : fix ? (
            <Text style={s.fieldText}>
              {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              {fix.accuracy != null && <Text style={s.muted}>{`  ±${Math.round(fix.accuracy)} m`}</Text>}
            </Text>
          ) : (
            <Text style={[s.fieldText, { color: c.wrong }]}>{locError ?? 'No location yet'}</Text>
          )}
          <Pressable onPress={locate} disabled={locating} accessibilityRole="button" hitSlop={8}>
            <Text style={s.link}>{fix ? 'Refresh' : 'Try again'}</Text>
          </Pressable>
        </View>

        {(showMap || (!fix && !locating)) && (
          <MapPicker
            pin={fix}
            onPick={(p) => {
              setFix({ lat: p.lat, lng: p.lng, accuracy: null, fromMap: true });
              setLocError(null);
            }}
            style={{ marginTop: space.s }}
          />
        )}
        <Pressable onPress={() => setShowMap(!showMap)} accessibilityRole="button" style={{ paddingVertical: space.xs }}>
          <Text style={s.link}>{showMap ? 'Hide map' : fix ? 'Adjust on map' : 'Set on map'}</Text>
        </Pressable>

        {fix && (
          <>
            <Text style={s.label}>Site (optional)</Text>
            <View style={s.siteRow}>
              {sites.map((st) => {
                const on = siteId === st.id;
                return (
                  <Pressable
                    key={st.id}
                    style={[s.licChip, on && { backgroundColor: c.accent, borderColor: c.accent }]}
                    onPress={() => setSiteId(on ? null : st.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[s.confText, on && { color: c.onAccent }]}>{st.name}</Text>
                  </Pressable>
                );
              })}
              {!naming && (
                <Pressable style={s.licChip} onPress={() => setNaming(true)} accessibilityRole="button">
                  <Text style={s.confText}>+ Name this place</Text>
                </Pressable>
              )}
            </View>
            {naming && (
              <View style={s.siteRow}>
                <TextInput
                  style={[s.field, { flex: 1, fontFamily: font.regular, fontSize: 15, color: c.ink }]}
                  placeholder="e.g. Lumley Beach"
                  placeholderTextColor={c.inkMuted}
                  value={siteName}
                  onChangeText={setSiteName}
                  maxLength={80}
                  autoFocus
                />
                <Pressable onPress={saveSite} disabled={siteName.trim().length < 2} accessibilityRole="button">
                  <Text style={[s.link, siteName.trim().length < 2 && { opacity: 0.4 }]}>Save</Text>
                </Pressable>
                <Pressable onPress={() => setNaming(false)} accessibilityRole="button">
                  <Text style={[s.link, { color: c.inkMuted }]}>Cancel</Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        <Text style={s.label}>How many</Text>
        <View style={s.stepper}>
          <Pressable
            style={s.stepButton}
            onPress={() => setCount(Math.max(1, count - 1))}
            accessibilityRole="button"
            accessibilityLabel="Fewer"
          >
            <Text style={s.stepText}>−</Text>
          </Pressable>
          <Text style={s.count} accessibilityLiveRegion="polite">
            {count}
          </Text>
          <Pressable
            style={s.stepButton}
            onPress={() => setCount(Math.min(100000, count + 1))}
            accessibilityRole="button"
            accessibilityLabel="More"
          >
            <Text style={s.stepText}>+</Text>
          </Pressable>
        </View>

        <FeaturePicker value={features} onChange={setFeatures} />

        <Text style={s.label}>Notes</Text>
        <TextInput
          style={[s.field, s.notes]}
          value={notes}
          onChangeText={setNotes}
          maxLength={2000}
          multiline
          placeholder="Behaviour, habitat, anything notable"
          placeholderTextColor={c.inkMuted}
          accessibilityLabel="Notes"
        />

        {error && (
          <Text style={s.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        {onOuting && (
          <Pressable
            style={[s.another, !ready && { opacity: 0.5 }]}
            onPress={() => save(true)}
            disabled={!ready}
            accessibilityRole="button"
          >
            <Text style={s.anotherText}>Save and log another</Text>
          </Pressable>
        )}
        <Pressable
          style={[s.save, !ready && { opacity: 0.5 }]}
          onPress={() => save()}
          disabled={!ready}
          accessibilityRole="button"
        >
          {saving ? (
            <View style={s.savingRow}>
              <ActivityIndicator color={c.onPrimary} />
              <Text style={s.saveText}>{saving}</Text>
            </View>
          ) : (
            <Text style={s.saveText}>{editId ? 'Save changes' : 'Save sighting'}</Text>
          )}
        </Pressable>
      </FormScroll>
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    unusual: { flexDirection: 'row', gap: space.s, alignItems: 'flex-start', backgroundColor: '#FFF6DD', borderRadius: radius.tile, padding: space.m },
    unusualText: { flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 19, color: c.ink },
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.screen, paddingTop: space.xxl, gap: space.s },
    title: { fontFamily: font.display, fontSize: 36, lineHeight: 40, color: c.ink, marginBottom: space.m },
    label: { fontFamily: font.medium, fontSize: 12, color: c.inkMuted, marginTop: space.m },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.m,
      backgroundColor: c.field,
      borderRadius: radius.chip,
      paddingHorizontal: space.l,
      minHeight: 48,
    },
    fieldText: { flex: 1, fontFamily: font.regular, fontSize: 15, color: c.ink },
    muted: { color: c.inkMuted },
    link: { fontFamily: font.semibold, fontSize: 14, color: c.ink, textDecorationLine: 'underline' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: space.l },
    stepButton: {
      width: 48,
      height: 48,
      borderRadius: radius.pill,
      borderColor: c.border,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepText: { fontFamily: font.semibold, fontSize: 22, color: c.ink },
    count: { fontFamily: font.bold, fontSize: 24, color: c.ink, minWidth: 48, textAlign: 'center' },
    notes: { minHeight: 96, paddingTop: space.m, textAlignVertical: 'top', fontFamily: font.regular, fontSize: 15, color: c.ink },
    error: { fontFamily: font.medium, fontSize: 14, color: c.wrong, textAlign: 'center' },
    another: {
      borderColor: c.primary,
      borderWidth: 1.5,
      borderRadius: radius.pill,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.s,
    },
    anotherText: { fontFamily: font.semibold, fontSize: 16, color: c.ink },
    outingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      backgroundColor: c.tint,
      borderRadius: radius.pill,
      paddingHorizontal: space.m,
      paddingVertical: 5,
    },
    outingText: { fontFamily: font.semibold, fontSize: 12, color: c.ink },
    save: {
      backgroundColor: c.primary,
      borderRadius: radius.pill,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.l,
    },
    saveText: { fontFamily: font.semibold, fontSize: 16, color: c.onPrimary },
    confidence: { flexDirection: 'row', gap: space.s, marginTop: space.s },
    confChip: {
      flex: 1,
      height: 40,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    siteRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s },
    soundRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginBottom: space.s },
    soundThumb: { flex: 1, height: 44, borderRadius: radius.chip, backgroundColor: '#1B1150' },
    soundText: { fontFamily: font.semibold, fontSize: 13, color: c.ink },
    addSound: {
      height: 44,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.m,
    },
    licChip: {
      height: 36,
      paddingHorizontal: space.m,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
    },
    confText: { fontFamily: font.semibold, fontSize: 13, color: c.ink },
    savingRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
    photos: { gap: space.s, paddingBottom: space.m },
    photo: { width: 88, height: 88, borderRadius: radius.chip },
    addPhoto: {
      borderColor: c.border,
      borderWidth: 1,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
    },
    addPlus: { fontFamily: font.bold, fontSize: 24, color: c.ink },
    addText: { fontFamily: font.medium, fontSize: 12, color: c.inkMuted },
    remove: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeText: { color: '#FFFFFF', fontSize: 16, lineHeight: 18 },
  });

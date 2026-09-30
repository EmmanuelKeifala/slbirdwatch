import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pressable } from '@/components/Pressable';

import {
  addIdentification,
  listIdentifications,
  shownSpecies,
  withdrawIdentification,
  type Identification,
  type Observation,
} from '@/api';
import { useAuth } from '@/state/auth';
import { signInFirst } from '@/lib/nav';
import { SpeciesPicker, type Picked } from '@/components/SpeciesPicker';
import { font, radius, space, useColors } from '@/theme';

/** VER-01: everyone's current IDs, plus agree / suggest / withdraw for signed-in members. */
export function CommunityId({ o, onChange }: { o: Observation; onChange: (o: Observation) => void }) {
  const c = useColors();
  const { session } = useAuth();
  const [ids, setIds] = useState<Identification[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [pick, setPick] = useState<Picked>(undefined);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listIdentifications(o.id)
      .then((r) => setIds(r.items))
      .catch(() => setIds([]));
  }, [o.id, o.status, o.community_species?.id]);

  const mine = session?.user.id === o.observer.id;
  const myId = ids?.find((i) => i.user.id === session?.user.id);
  const leading = shownSpecies(o);

  async function run(action: () => Promise<Observation>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
      setSuggesting(false);
      setPick(undefined);
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.m }}>
      <Text style={[styles.h2, { color: c.ink }]}>Community ID</Text>

      {/* The observer's own claim comes first. */}
      <Row
        name={o.observer.display_name}
        tag="Observer"
        species={o.species?.english_name ?? "Didn't know"}
        sci={o.species?.scientific_name}
      />
      {ids === null ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        ids.map((i) => (
          <Row
            key={i.id}
            name={i.user.display_name}
            tag={i.verifier ? 'Verifier' : undefined}
            species={i.species.english_name}
            sci={i.species.scientific_name}
            reason={i.reason}
          />
        ))
      )}

      {!session ? (
        <Pressable
          onPress={() => signInFirst('Sign in to suggest or agree with an ID. You’ll come straight back here.')}
          accessibilityRole="button"
        >
          <Text style={[styles.link, { color: c.accentDeep }]}>Sign in to help identify this bird</Text>
        </Pressable>
      ) : mine ? null : suggesting ? (
        <View style={{ gap: space.s }}>
          <SpeciesPicker value={pick} onChange={setPick} month={new Date(o.observed_at).getMonth() + 1} />
          <TextInput
            style={[styles.input, { backgroundColor: c.field, color: c.ink }]}
            placeholder="Why? e.g. white collar, heavy bill (optional)"
            placeholderTextColor={c.inkFaint}
            value={reason}
            onChangeText={setReason}
            maxLength={500}
          />
          <View style={styles.actions}>
            <Pressable style={[styles.secondary, { borderColor: c.border }]} onPress={() => setSuggesting(false)}>
              <Text style={[styles.secondaryText, { color: c.ink }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primary, { backgroundColor: c.primary }, (!pick || busy) && { opacity: 0.5 }]}
              disabled={!pick || busy}
              onPress={() => pick && run(() => addIdentification(session.token, o.id, pick.id, reason.trim()))}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryText, { color: c.onPrimary }]}>Submit ID</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {leading && myId?.species.id !== leading.id && (
            <Pressable
              style={[styles.primary, { backgroundColor: c.primary }, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={() => run(() => addIdentification(session.token, o.id, leading.id, ''))}
              accessibilityRole="button"
              accessibilityLabel={`Agree: ${leading.english_name}`}
            >
              <Feather name="check" size={16} color={c.onPrimary} />
              <Text style={[styles.primaryText, { color: c.onPrimary }]} numberOfLines={1}>
                Agree
              </Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.secondary, { borderColor: c.border }]}
            onPress={() => setSuggesting(true)}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryText, { color: c.ink }]}>{leading ? 'Suggest another' : 'Suggest an ID'}</Text>
          </Pressable>
        </View>
      )}
      {myId && !suggesting && (
        <Pressable
          onPress={() => run(() => withdrawIdentification(session!.token, o.id))}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={[styles.link, { color: c.inkMuted }]}>Withdraw my ID ({myId.species.english_name})</Text>
        </Pressable>
      )}
      {error && <Text style={[styles.link, { color: c.wrong }]}>{error}</Text>}
    </View>
  );
}

function Row({ name, tag, species, sci, reason }: { name: string; tag?: string; species: string; sci?: string; reason?: string }) {
  const c = useColors();
  return (
    <View style={[styles.row, { borderColor: c.border }]}>
      <View style={[styles.avatar, { backgroundColor: c.tint }]}>
        <Text style={[styles.avatarText, { color: c.tintIcon }]}>{name[0]?.toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.who, { color: c.inkMuted }]}>
          {name}
          {tag ? ` · ${tag}` : ''}
        </Text>
        <Text style={[styles.species, { color: c.ink }]}>{species}</Text>
        {!!sci && <Text style={[styles.sci, { color: c.inkMuted }]}>{sci}</Text>}
        {!!reason && <Text style={[styles.reason, { color: c.inkMuted }]}>“{reason}”</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { fontFamily: font.bold, fontSize: 18, marginTop: space.xl },
  row: { flexDirection: 'row', gap: space.m, borderWidth: 1.5, borderRadius: radius.tile, padding: space.m },
  avatar: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.bold, fontSize: 14 },
  who: { fontFamily: font.semibold, fontSize: 12 },
  species: { fontFamily: font.bold, fontSize: 15, marginTop: 2 },
  sci: { fontFamily: font.italic, fontSize: 12 },
  reason: { fontFamily: font.regular, fontSize: 13, marginTop: 4 },
  actions: { flexDirection: 'row', gap: space.s },
  primary: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
  secondary: { flex: 1, height: 48, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: font.semibold, fontSize: 15 },
  input: { fontFamily: font.regular, fontSize: 15, borderRadius: radius.chip, paddingHorizontal: space.l, height: 48 },
  link: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', paddingVertical: space.s },
});

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/components/FormScroll';
import { searchPeople, setRole, type Person, type Role } from '@/api';
import { useAuth } from '@/state/auth';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SearchField } from '@/components/SearchField';
import { font, radius, space, useColors } from '@/theme';

const ROLES: { role: Role; label: string; hint: string }[] = [
  { role: 'member', label: 'Member', hint: 'Uploads, suggests IDs' },
  { role: 'trusted', label: 'Trusted', hint: 'Experienced member' },
  { role: 'verifier', label: 'Verifier', hint: 'Confirms IDs, curates quiz media' },
  { role: 'moderator', label: 'Moderator', hint: 'Also handles flags and reports' },
  { role: 'admin', label: 'Admin', hint: 'Also roles, taxonomy, sensitive species' },
];

/** ADM-04 (admins): find people and set their role. Changes apply at once and are logged. */
export default function People() {
  const c = useColors();
  const { session } = useAuth();
  const token = session!.token;
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      searchPeople(token, q.trim())
        .then((r) => setPeople(r.items))
        .catch(() => setPeople([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, token]);

  const change = (p: Person, role: Role) =>
    Alert.alert(`Make ${p.display_name} a ${ROLES.find((r) => r.role === role)!.label.toLowerCase()}?`, ROLES.find((r) => r.role === role)!.hint, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Change role',
        onPress: () =>
          setRole(token, p.id, role)
            .then(() => setPeople((list) => list && list.map((x) => (x.id === p.id ? { ...x, role } : x))))
            .catch((e) => Alert.alert('Couldn’t change the role', e instanceof Error ? e.message : String(e))),
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="People and roles" back />
      <FormScroll contentContainerStyle={styles.content}>
        <SearchField value={q} onChange={setQ} placeholder="Search by name or email" />
        {!q.trim() && <Text style={[styles.hint, { color: c.inkMuted }]}>Admins, moderators and verifiers first.</Text>}
        {people === null ? (
          <ActivityIndicator color={c.accent} />
        ) : people.length === 0 ? (
          <Text style={[styles.hint, { color: c.inkMuted, textAlign: 'center' }]}>No one found.</Text>
        ) : (
          people.map((p) => (
            <View key={p.id} style={[styles.card, { borderColor: c.border }]}>
              <Text style={[styles.name, { color: c.ink }]}>
                {p.display_name}
                {p.id === session!.user.id ? ' (you)' : ''}
              </Text>
              <Text style={[styles.hint, { color: c.inkMuted }]}>{p.email}</Text>
              <View style={styles.chips}>
                {ROLES.map((r) => {
                  const on = p.role === r.role;
                  const self = p.id === session!.user.id;
                  return (
                    <Pressable
                      key={r.role}
                      disabled={on || self}
                      onPress={() => change(p, r.role)}
                      style={[styles.chip, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.bg }, self && !on && { opacity: 0.4 }]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on, disabled: self }}
                    >
                      <Text style={[styles.chipText, { color: on ? c.onAccent : c.ink }]}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  hint: { fontFamily: font.regular, fontSize: 13 },
  card: { borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.xs },
  name: { fontFamily: font.bold, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  chip: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 6 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
});

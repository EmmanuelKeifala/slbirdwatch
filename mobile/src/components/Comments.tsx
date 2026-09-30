import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { addComment, deleteComment, isModerator, listComments, moderateComment, reportComment, type Comment } from '@/api';
import { useAuth } from '@/state/auth';
import { signInFirst } from '@/lib/nav';
import { Pressable } from '@/components/Pressable';
import { font, radius, space, useColors } from '@/theme';

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** VER-09: comments on a sighting, one level of replies. */
export function Comments({ observationId }: { observationId: number }) {
  const c = useColors();
  const { session } = useAuth();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const token = session?.token;

  const load = useCallback(() => {
    listComments(observationId, token)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [observationId, token]);
  useEffect(load, [load]);

  const fail = (e: unknown) => Alert.alert('Couldn’t do that', e instanceof Error ? e.message : String(e));

  async function send() {
    if (!token) return signInFirst('Sign in to join the conversation.');
    setBusy(true);
    try {
      await addComment(token, observationId, text.trim(), replyTo?.id);
      setText('');
      setReplyTo(null);
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const menu = (cm: Comment) => {
    if (!token) return signInFirst('Sign in to report a comment.');
    const mine = cm.author.id === session!.user.id;
    const report = (reason: 'spam' | 'harassment' | 'inappropriate' | 'other') =>
      reportComment(token, cm.id, reason).then(() => Alert.alert('Thanks', 'A moderator will take a look.'), fail);
    Alert.alert(cm.author.display_name, undefined, [
      ...(mine
        ? [{ text: 'Delete comment', style: 'destructive' as const, onPress: () => deleteComment(token, cm.id).then(load, fail) }]
        : [
            { text: 'Report: spam', onPress: () => report('spam') },
            { text: 'Report: harassment', onPress: () => report('harassment') },
            { text: 'Report: inappropriate', onPress: () => report('inappropriate') },
          ]),
      ...(isModerator(session!.user) && !mine
        ? [
            {
              text: cm.hidden ? 'Restore (moderator)' : 'Hide (moderator)',
              onPress: () => moderateComment(token, cm.id, cm.hidden ? 'restore' : 'hide').then(load, fail),
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const row = (cm: Comment, reply: boolean) => (
    <View key={cm.id} style={[styles.row, reply && styles.reply]}>
      <View style={[styles.avatar, { backgroundColor: c.tint }]}>
        <Text style={[styles.avatarText, { color: c.tintIcon }]}>{cm.author.display_name[0]?.toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.meta, { color: c.inkMuted }]}>
          <Text style={{ color: c.ink, fontFamily: font.semibold }}>{cm.author.display_name}</Text> · {ago(cm.created_at)}
          {cm.hidden ? ' · hidden' : ''}
        </Text>
        <Text style={[styles.body, { color: cm.deleted ? c.inkFaint : c.ink }, cm.deleted && { fontFamily: font.italic }]}>
          {cm.deleted ? 'Comment deleted' : cm.body}
        </Text>
        {!cm.deleted && (
          <View style={styles.actions}>
            {!reply && (
              <Pressable onPress={() => (token ? setReplyTo(cm) : signInFirst('Sign in to reply.'))} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.action, { color: c.accentDeep }]}>Reply</Text>
              </Pressable>
            )}
            <Pressable onPress={() => menu(cm)} hitSlop={8} accessibilityRole="button" accessibilityLabel="More">
              <Feather name="more-horizontal" size={16} color={c.inkMuted} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ gap: space.m }}>
      <Text style={[styles.h2, { color: c.ink }]}>Comments{items?.length ? ` · ${items.length}` : ''}</Text>
      {items === null ? (
        <ActivityIndicator color={c.accent} />
      ) : items.length === 0 ? (
        <Text style={[styles.body, { color: c.inkMuted }]}>No comments yet. Ask about the bird, or share what you noticed.</Text>
      ) : (
        items.map((t) => (
          <View key={t.id} style={{ gap: space.s }}>
            {row(t, false)}
            {(t.replies ?? []).map((r) => row(r, true))}
          </View>
        ))
      )}

      {replyTo && (
        <View style={[styles.replying, { backgroundColor: c.field }]}>
          <Text style={[styles.meta, { color: c.inkMuted, flex: 1 }]}>Replying to {replyTo.author.display_name}</Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
            <Feather name="x" size={16} color={c.inkMuted} />
          </Pressable>
        </View>
      )}
      <View style={[styles.composer, { backgroundColor: c.field }]}>
        <TextInput
          style={[styles.input, { color: c.ink }]}
          placeholder={token ? 'Add a comment…' : 'Sign in to comment'}
          placeholderTextColor={c.inkFaint}
          value={text}
          onChangeText={setText}
          onFocus={() => !token && signInFirst('Sign in to join the conversation.')}
          maxLength={1000}
          multiline
        />
        <Pressable
          style={[styles.send, { backgroundColor: c.primary }, (!text.trim() || busy) && { opacity: 0.4 }]}
          onPress={send}
          disabled={!text.trim() || busy}
          accessibilityRole="button"
          accessibilityLabel="Send comment"
        >
          <Feather name="send" size={16} color={c.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { fontFamily: font.bold, fontSize: 18, marginTop: space.xl },
  row: { flexDirection: 'row', gap: space.m },
  reply: { marginLeft: 44 },
  avatar: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.bold, fontSize: 13 },
  meta: { fontFamily: font.medium, fontSize: 12 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.l, marginTop: 2 },
  action: { fontFamily: font.semibold, fontSize: 13 },
  replying: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.chip, paddingHorizontal: space.m, paddingVertical: space.s },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s, borderRadius: radius.tile, padding: space.s, paddingLeft: space.l },
  input: { flex: 1, fontFamily: font.regular, fontSize: 15, maxHeight: 120, paddingVertical: space.s },
  send: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});

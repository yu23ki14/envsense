/**
 * TranscriptScreen — 「日別 文字起こし」モーダルの本体。
 *
 * URL パラメータ `date` (yyyy-MM-dd) の音声セッションを読み出し、各セッション
 * ごとに 再生プレイヤ（Android / Web のみ）と、10 秒チャンク単位の文字起こしを
 * 時刻付きで並べる。
 */
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ModalScreen, SectionHeader } from '../components';
import type { AudioChunk, AudioSession } from '../data';
import { absoluteUri, dateKey, useAudioChunksForDay, useAudioSessionsForDay } from '../data';
import { Icon, Text } from '../ui';

function formatDate(date: Date): string {
  return format(date, 'M 月 d 日 EEEE', { locale: ja });
}

function formatClock(ms: number): string {
  return format(ms, 'HH:mm');
}

function formatClockSeconds(ms: number): string {
  return format(ms, 'HH:mm:ss');
}

function formatDurationFromSeconds(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function TranscriptScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const now = useMemo(() => new Date(), []);
  const resolvedDate = useMemo(
    () =>
      typeof params.date === 'string' && params.date.length > 0
        ? params.date
        : dateKey(now.getTime()),
    [params.date, now],
  );
  const dateObj = useMemo(() => parseISO(resolvedDate), [resolvedDate]);

  const sessions = useAudioSessionsForDay(resolvedDate);
  const chunks = useAudioChunksForDay(resolvedDate);

  const chunksBySession = useMemo(() => {
    const map = new Map<string, AudioChunk[]>();
    for (const chunk of chunks) {
      const list = map.get(chunk.sessionId);
      if (list) list.push(chunk);
      else map.set(chunk.sessionId, [chunk]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startedAt - b.startedAt);
    }
    return map;
  }, [chunks]);

  return (
    <ModalScreen title={formatDate(dateObj)} subtitle="録音と文字起こし">
      <View style={styles.flow}>
        {sessions.length === 0 ? (
          <View style={styles.gutter}>
            <Card tone="soft" padding="md">
              <Text variant="caption" color="textMuted">
                この日の録音はまだありません。デバイスを接続すると音声が記録され、文字起こしされます。
              </Text>
            </Card>
          </View>
        ) : (
          // Newest recording first. The label keeps the chronological number
          // (session 1 = first of the day) even though it renders last.
          sessions
            .map((session, index) => ({ session, number: index + 1 }))
            .reverse()
            .map(({ session, number }) => (
              <SessionBlock
                key={session.id}
                session={session}
                number={number}
                chunks={chunksBySession.get(session.id) ?? []}
              />
            ))
        )}
      </View>
    </ModalScreen>
  );
}

function SessionBlock({
  session,
  number,
  chunks,
}: {
  session: AudioSession;
  number: number;
  chunks: AudioChunk[];
}) {
  const range = `${formatClock(session.startedAt)} – ${formatClock(session.endedAt)}`;
  const duration = formatDurationFromSeconds(session.durationMs / 1000);
  // Newest segment first, matching the session ordering.
  const orderedChunks = [...chunks].reverse();
  return (
    <View>
      <SectionHeader kicker={`セッション ${number}`} title={range} />
      <View style={[styles.gutter, styles.list]}>
        <Card padding="md">
          {Platform.OS === 'ios' ? (
            // iOS の AVPlayer は Ogg/Opus を再生できないため、再生 UI は出さない。
            // 文字起こしは表示し、再生対応は将来 AAC への変換で行う。
            <Text variant="caption" color="textMuted">
              録音 {duration}（iOS では音声再生に未対応）
            </Text>
          ) : (
            <SessionPlayer uri={absoluteUri(session.filePath)} duration={duration} />
          )}
        </Card>

        {chunks.length === 0 ? (
          <Card tone="soft" padding="md">
            <Text variant="caption" color="textMuted">
              文字起こしはまだありません。
            </Text>
          </Card>
        ) : (
          <Card padding="md">
            <View style={styles.transcriptList}>
              {orderedChunks.map((chunk) => (
                <View key={chunk.id} style={styles.transcriptItem}>
                  <Text variant="caption" color="textMuted">
                    {formatClockSeconds(chunk.startedAt)}
                  </Text>
                  {chunk.transcript != null ? (
                    <Text variant="body">{chunk.transcript.text}</Text>
                  ) : (
                    <Text variant="body" color="textMuted">
                      文字起こし中…
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </Card>
        )}
      </View>
    </View>
  );
}

function SessionPlayer({ uri, duration }: { uri: string; duration: string }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const position = formatDurationFromSeconds(status.currentTime ?? 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? '一時停止' : '再生'}
      onPress={() => (playing ? player.pause() : player.play())}
      style={styles.player}
    >
      <View style={styles.playButton}>
        <Icon name={playing ? 'pause' : 'play'} size={18} color="onPrimary" />
      </View>
      <Text variant="label" weight="bold">
        {position} / {duration}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  flow: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  gutter: {
    paddingHorizontal: theme.spacing.lg,
  },
  list: {
    gap: theme.spacing.sm,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcriptList: {
    gap: theme.spacing.sm,
  },
  transcriptItem: {
    gap: theme.spacing.xxs,
  },
}));

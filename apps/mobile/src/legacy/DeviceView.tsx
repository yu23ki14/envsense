import * as React from 'react';
import { Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Agent } from '../agent/Agent';
import type { BleDevice } from '../modules/ble';
import { rotateImage } from '../modules/imaging';
import { useTranscripts } from '../modules/useTranscripts';
import { toBase64Image } from '../utils/base64';
import { InvalidateSync } from '../utils/invalidateSync';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const FIRMWARE_REVISION_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
const PHOTO_DATA_UUID = 'ea800005-9c72-497f-81f9-752ffe11f565';
const PHOTO_CONTROL_UUID = 'ea800006-9c72-497f-81f9-752ffe11f565';

type Rotation = '0' | '90' | '180' | '270';
type Photo = { data: Uint8Array; timestamp: number; rotation: Rotation };

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

function usePhotos(device: BleDevice) {
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [subscribed, setSubscribed] = React.useState<boolean>(false);

  React.useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      // Get firmware version (best-effort).
      let firmwareVersion = '0.0.0';
      try {
        const deviceInfoService = await device.getService(DEVICE_INFO_SERVICE_UUID);
        const firmwareChar = await deviceInfoService.getCharacteristic(FIRMWARE_REVISION_UUID);
        const firmwareBytes = await firmwareChar.read();
        firmwareVersion = new TextDecoder().decode(firmwareBytes);
      } catch (e) {
        console.error('Failed to read firmware version', e);
      }
      const newRotationLogic = compareVersions(firmwareVersion, '2.1.1') >= 0;

      let previousChunk = -1;
      let buffer: Uint8Array = new Uint8Array(0);
      let orientation = 0;

      function onChunk(id: number | null, data: Uint8Array) {
        if (previousChunk === -1) {
          if (id === null) {
            return;
          } else if (id === 0) {
            previousChunk = 0;
            buffer = new Uint8Array(0);
            if (newRotationLogic) {
              orientation = data[0];
              data = data.slice(1);
            }
          } else {
            return;
          }
        } else {
          if (id === null) {
            console.log('Photo received', buffer);
            const timestamp = Date.now();
            let rotation: Rotation = '180';
            if (newRotationLogic) {
              rotation = '0';
              if (orientation === 1) rotation = '90';
              else if (orientation === 2) rotation = '180';
              else if (orientation === 3) rotation = '270';
            }
            rotateImage(buffer, rotation).then((rotated) => {
              if (cancelled) return;
              // rotateImage bakes rotation into pixels on web; on
              // native it's a no-op so we have to apply the
              // rotation at render time instead.
              const displayRotation: Rotation = Platform.OS === 'web' ? '0' : rotation;
              setPhotos((p) => [...p, { data: rotated, timestamp, rotation: displayRotation }]);
            });
            previousChunk = -1;
            return;
          } else {
            if (id !== previousChunk + 1) {
              previousChunk = -1;
              console.error('Invalid chunk', id, previousChunk);
              return;
            }
            previousChunk = id;
          }
        }
        buffer = new Uint8Array([...buffer, ...data]);
      }

      const service = await device.getService(ENVSENSE_SERVICE_UUID);
      const photoCharacteristic = await service.getCharacteristic(PHOTO_DATA_UUID);
      unsubscribe = await photoCharacteristic.subscribe((array) => {
        if (cancelled) return;
        if (array[0] === 0xff && array[1] === 0xff) {
          onChunk(null, new Uint8Array());
        } else {
          const packetId = array[0] + (array[1] << 8);
          onChunk(packetId, array.slice(2));
        }
      });
      setSubscribed(true);

      // Trigger automatic photo capture every 5 seconds.
      const photoControlCharacteristic = await service.getCharacteristic(PHOTO_CONTROL_UUID);
      await photoControlCharacteristic.write(new Uint8Array([0x05]));
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [device]);

  return [subscribed, photos] as const;
}

export const DeviceView = React.memo((props: { device: BleDevice }) => {
  const [, photos] = usePhotos(props.device);
  const transcripts = useTranscripts(props.device);
  const agent = React.useMemo(() => new Agent(), []);
  agent.use();
  const [activePhotoIndex, setActivePhotoIndex] = React.useState<number | null>(null);

  const processedPhotos = React.useRef<Uint8Array[]>([]);
  const sync = React.useMemo(() => {
    let processed = 0;
    return new InvalidateSync(async () => {
      if (processedPhotos.current.length > processed) {
        const unprocessed = processedPhotos.current.slice(processed);
        processed = processedPhotos.current.length;
        await agent.addPhoto(unprocessed);
      }
    });
  }, [agent]);
  React.useEffect(() => {
    processedPhotos.current = photos.map((p) => p.data);
    sync.invalidate();
  }, [photos, sync]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      {/* Photo grid: top 70% */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: '30%',
          backgroundColor: '#111',
        }}
      >
        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 5 }}>
          {photos
            .slice()
            .reverse()
            .map((photo, index) => (
              <Pressable
                key={photo.timestamp}
                onPressIn={() => setActivePhotoIndex(photos.length - 1 - index)}
                onPressOut={() => setActivePhotoIndex(null)}
                style={{
                  position: 'relative',
                  width: '33%',
                  aspectRatio: 1,
                  padding: 2,
                }}
              >
                <Image
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 5,
                    transform:
                      photo.rotation === '0' ? undefined : [{ rotate: `${photo.rotation}deg` }],
                  }}
                  source={{ uri: toBase64Image(photo.data) }}
                />
                {activePhotoIndex === photos.length - 1 - index && (
                  <View
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      left: 2,
                      right: 2,
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      paddingVertical: 3,
                      paddingHorizontal: 5,
                      alignItems: 'center',
                      borderRadius: 3,
                    }}
                  >
                    <Text style={{ color: 'white', fontSize: 10 }}>
                      {new Date(photo.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                )}
              </Pressable>
            ))}
        </ScrollView>
      </View>

      {/* Transcript panel: bottom 30% */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '30%',
          backgroundColor: '#000',
          borderTopWidth: 1,
          borderTopColor: '#333',
        }}
      >
        <Text style={{ color: '#888', fontSize: 11, padding: 6 }}>
          Transcripts ({transcripts.length})
        </Text>
        <ScrollView contentContainerStyle={{ padding: 8 }}>
          {transcripts
            .slice()
            .reverse()
            .map((t) => (
              <View key={t.timestamp} style={{ marginBottom: 6 }}>
                <Text style={{ color: '#666', fontSize: 10 }}>
                  {new Date(t.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={{ color: '#fff', fontSize: 13 }}>{t.text}</Text>
              </View>
            ))}
        </ScrollView>
      </View>
    </View>
  );
});

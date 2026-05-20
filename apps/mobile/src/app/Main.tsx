import * as React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useDevice } from '../modules/useDevice';
import { RoundButton } from './components/RoundButton';
import { Theme } from './components/theme';
import { DeviceView } from './DeviceView';

export const Main = React.memo(() => {
  const [device, connectDevice, status] = useDevice();

  let statusText: string | null = null;
  if (status.isAutoConnecting) {
    statusText = 'Reconnecting to envsense...';
  } else if (status.isConnecting) {
    statusText = 'Connecting to envsense...';
  }

  return (
    <SafeAreaView style={styles.container}>
      {!device && (
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', alignSelf: 'center' }}
        >
          {statusText ? (
            <Text style={styles.statusText}>{statusText}</Text>
          ) : (
            <RoundButton title="Connect to the device" action={connectDevice} />
          )}
        </View>
      )}
      {device && <DeviceView device={device} />}
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.background,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  statusText: {
    color: Theme.text,
    fontSize: 18,
    marginBottom: 16,
  },
});

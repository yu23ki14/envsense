import * as React from 'react';
import { SafeAreaView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useDevice } from '../modules/useDevice';
import { Button, Text } from '../ui';
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
    <SafeAreaView style={styles.screen}>
      {!device && (
        <View style={styles.connect}>
          {statusText ? (
            <Text variant="body" color="textMuted">
              {statusText}
            </Text>
          ) : (
            <Button onPress={connectDevice}>Connect to the device</Button>
          )}
        </View>
      )}
      {device && <DeviceView device={device} />}
    </SafeAreaView>
  );
});

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
  },
  connect: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.lg,
    padding: theme.spacing.lg,
  },
}));

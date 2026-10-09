import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface Props {
  onPress: () => void;
  disabled?: boolean;
}

export function ShutterButton({ onPress, disabled }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Take Polaroid photo"
      style={[styles.ring, disabled && styles.ringDisabled]}
    >
      <View style={[styles.core, disabled && styles.coreDisabled]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#f5f2e8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  ringDisabled: {
    borderColor: '#55534e',
  },
  core: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f5f2e8',
  },
  coreDisabled: {
    backgroundColor: '#55534e',
  },
});

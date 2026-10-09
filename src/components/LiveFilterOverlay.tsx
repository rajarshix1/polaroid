import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  size: number;
}

const VIGNETTE_EDGE = 'rgba(26,13,6,0.42)';
const CLEAR = 'rgba(26,13,6,0)';
const LEAK = 'rgba(255,160,70,0.20)';
const LEAK_CLEAR = 'rgba(255,160,70,0)';

/**
 * Live approximation of the baked Polaroid 600 grade, built from overlays
 * (expo-camera gives us no access to live frames). The finished print is
 * still rendered by the Skia pipeline in src/filters/polaroid.ts.
 */
export function LiveFilterOverlay({ size }: Props) {
  const band = Math.round(size * 0.3);
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      {/* Warm grade wash */}
      <View style={[styles.fill, { backgroundColor: 'rgba(255,178,102,0.14)' }]} />
      {/* Faded-blacks veil */}
      <View style={[styles.fill, { backgroundColor: 'rgba(215,200,180,0.10)' }]} />
      {/* Top-right light leak */}
      <LinearGradient
        style={styles.fill}
        colors={[LEAK, LEAK_CLEAR]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.35, y: 0.65 }}
      />
      {/* Vignette, four edges */}
      <LinearGradient
        style={[styles.edgeH, { top: 0, height: band }]}
        colors={[VIGNETTE_EDGE, CLEAR]}
      />
      <LinearGradient
        style={[styles.edgeH, { bottom: 0, height: band }]}
        colors={[CLEAR, VIGNETTE_EDGE]}
      />
      <LinearGradient
        style={[styles.edgeV, { left: 0, width: band }]}
        colors={[VIGNETTE_EDGE, CLEAR]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
      />
      <LinearGradient
        style={[styles.edgeV, { right: 0, width: band }]}
        colors={[CLEAR, VIGNETTE_EDGE]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  edgeH: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  edgeV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});

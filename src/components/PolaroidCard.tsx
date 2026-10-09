import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
  /** Edge length of the square photo area, in px. */
  photoSize: number;
  caption: string;
}

/** On-screen Polaroid 600 card. Mirrors the export geometry in src/filters/polaroid.ts. */
export function PolaroidCard({ children, photoSize, caption }: Props) {
  const side = Math.round(photoSize * 0.062);
  const bottom = Math.round(photoSize * 0.21);

  return (
    <View
      style={[
        styles.card,
        {
          width: photoSize + side * 2,
          paddingTop: side,
          paddingHorizontal: side,
          paddingBottom: bottom,
        },
      ]}
    >
      <View style={{ width: photoSize, height: photoSize, backgroundColor: '#111' }}>
        {children}
      </View>
      <View style={styles.captionRow}>
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
        <Text style={styles.brand}>POLAR</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FAF6EC',
    borderRadius: 6,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 6,
  },
  caption: {
    flex: 1,
    fontSize: 15,
    fontStyle: 'italic',
    color: '#4a4238',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  brand: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#8a7f6d',
    marginLeft: 12,
  },
});

import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';

interface Props {
  uri: string;
  size: number;
}

const DEVELOP_MS = 3200;

/** Stylized film development: milky veil lifts to reveal the print. */
export function DevelopingPhoto({ uri, size }: Props) {
  const [veil] = useState(() => new Animated.Value(1));

  useEffect(() => {
    veil.setValue(1);
    const anim = Animated.timing(veil, {
      toValue: 0,
      duration: DEVELOP_MS,
      delay: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [uri, veil]);

  return (
    <>
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={0}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: '#f2ecdd', opacity: veil },
        ]}
      />
      <Animated.View pointerEvents="none" style={[styles.labelWrap, { opacity: veil }]}>
        <Text style={styles.label}>Developing…</Text>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#8a7f6d',
  },
});

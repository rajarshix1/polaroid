import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  Linking,
  Platform,
  ScrollView,
  Share,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library/legacy';
import { PolaroidCard } from './src/components/PolaroidCard';
import { ShutterButton } from './src/components/ShutterButton';
import { DevelopingPhoto } from './src/components/DevelopingPhoto';
import { developPolaroid, type DevelopedPhoto } from './src/filters/polaroid';

const ALBUM_TITLE = 'Polar';

interface Shot extends DevelopedPhoto {
  caption: string;
}

function todayCaption(): string {
  return new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const FLASH_ORDER: FlashMode[] = ['off', 'on', 'auto'];
const FLASH_ICON = {
  off: 'flash-off-outline',
  on: 'flash',
  auto: 'flash-outline',
  screen: 'flash',
} as const;

export default function App() {
  const [camPermission, requestCamPermission] = useCameraPermissions();
  // 'photo' only: Expo Go's manifest lacks the audio permission, and we only shoot stills.
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions({
    granularPermissions: ['photo'],
  });
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [cameraReady, setCameraReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [film, setFilm] = useState<Shot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);

  const { width, height } = Dimensions.get('window');
  const squareSize = Math.floor(width - 56);
  const squareTop = Math.floor((height - squareSize) / 2);
  const squareLeft = Math.floor((width - squareSize) / 2);
  const cardPhotoSize = Math.floor(width - 48);

  const camGranted = camPermission?.granted === true;
  const mediaGranted = mediaPermission?.granted === true;

  // Ask for camera + storage the moment the app opens.
  const askAll = useCallback(async () => {
    try {
      if (!camGranted) {
        await requestCamPermission();
      }
    } catch {
      // Surfaced through the gate below.
    }
    try {
      if (!mediaGranted) {
        await requestMediaPermission();
      }
    } catch {
      // Surfaced through the gate below.
    }
    setAsked(true);
  }, [camGranted, mediaGranted, requestCamPermission, requestMediaPermission]);

  useEffect(() => {
    askAll();
  }, [askAll]);

  // Keep asking every time the user returns until everything is granted.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        askAll();
      }
    });
    return () => sub.remove();
  }, [askAll]);

  // Load the persistent Polar album for the film strip.
  useEffect(() => {
    if (!mediaGranted) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const album = await MediaLibrary.getAlbumAsync(ALBUM_TITLE).catch(() => null);
        if (!album) {
          return;
        }
        const { assets } = await MediaLibrary.getAssetsAsync({
          album,
          first: 20,
          mediaType: 'photo',
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        if (!cancelled) {
          setFilm(
            assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, caption: '' })),
          );
        }
      } catch {
        // Album is a nice-to-have; session film still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaGranted]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef || !cameraReady || working) {
      return;
    }
    setError(null);
    setWorking(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      const captured = await cameraRef.takePictureAsync({
        quality: 1,
        exif: false,
      });
      if (!captured?.uri) {
        throw new Error('Shutter failed — try again');
      }

      const caption = todayCaption();
      let finished: Shot;
      try {
        const print = await developPolaroid(captured.uri);
        finished = { ...print, caption };
      } catch (e) {
        // Degraded path: show the raw square-cropped shot in the card.
        console.warn('Filter failed, using raw capture', e);
        finished = { uri: captured.uri, width: captured.width, height: captured.height, caption };
      }

      // Auto-save, like a real Polaroid: the print exists the moment it is taken.
      try {
        if (!mediaGranted) {
          await requestMediaPermission();
        }
        const asset = await MediaLibrary.createAssetAsync(finished.uri);
        const album = await MediaLibrary.getAlbumAsync(ALBUM_TITLE).catch(() => null);
        if (album) {
          await MediaLibrary.addAssetsToAlbumAsync(asset, album, false);
        } else {
          await MediaLibrary.createAlbumAsync(ALBUM_TITLE, asset, false);
        }
      } catch (e) {
        console.warn('Auto-save failed', e);
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFilm((prev) => [finished, ...prev].slice(0, 20));
      setShot(finished);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setWorking(false);
    }
  }, [cameraRef, cameraReady, working, mediaGranted, requestMediaPermission]);

  const shareShot = useCallback(async () => {
    if (!shot) {
      return;
    }
    try {
      await Share.share({ url: shot.uri });
    } catch (e) {
      console.warn('Share failed', e);
    }
  }, [shot]);

  // ---- Permission gate: blocks until camera + storage are both granted ----
  if (!asked || !camPermission || !mediaPermission || !camGranted || !mediaGranted) {
    const camBlocked = !!camPermission && !camGranted && !camPermission.canAskAgain;
    const mediaBlocked =
      !!mediaPermission && !mediaGranted && !mediaPermission.canAskAgain;
    const needsSettings = camBlocked || mediaBlocked;
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.title}>POLAR</Text>
        <Text style={styles.hint}>One button. One Polaroid. No edits.</Text>
        <View style={styles.permList}>
          <View style={styles.permRow}>
            <Ionicons
              name={camGranted ? 'checkmark-circle' : 'camera-outline'}
              size={22}
              color={camGranted ? '#7fc97f' : '#f5f2e8'}
            />
            <Text style={styles.permText}>Camera {camGranted ? 'granted' : 'needed'}</Text>
          </View>
          <View style={styles.permRow}>
            <Ionicons
              name={mediaGranted ? 'checkmark-circle' : 'images-outline'}
              size={22}
              color={mediaGranted ? '#7fc97f' : '#f5f2e8'}
            />
            <Text style={styles.permText}>Photos {mediaGranted ? 'granted' : 'needed'}</Text>
          </View>
        </View>
        {asked && (!camGranted || !mediaGranted) && (
          <TouchableOpacity
            style={styles.pill}
            onPress={() => {
              if (needsSettings) {
                Linking.openSettings();
              } else {
                askAll();
              }
            }}
          >
            <Text style={styles.pillText}>
              {needsSettings ? 'Open Settings to allow' : 'Grant access'}
            </Text>
          </TouchableOpacity>
        )}
        {asked && !needsSettings && (!camGranted || !mediaGranted) && (
          <Text style={[styles.hint, styles.permNote]}>
            Polar cannot work without these — allow to continue.
          </Text>
        )}
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {shot ? (
        // ---- Finished print ----
        <View style={styles.result}>
          <PolaroidCard photoSize={cardPhotoSize} caption={shot.caption}>
            <DevelopingPhoto key={shot.uri} uri={shot.uri} size={cardPhotoSize} />
          </PolaroidCard>
          <View style={styles.resultButtons}>
            <TouchableOpacity style={styles.pill} onPress={() => setShot(null)}>
              <Text style={styles.pillText}>New photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.pill, styles.pillPrimary]} onPress={shareShot}>
              <Text style={[styles.pillText, styles.pillPrimaryText]}>Share print</Text>
            </TouchableOpacity>
          </View>
          {film.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
            >
              {film.map((f, i) => (
                <TouchableOpacity
                  key={`${f.uri}-${i}`}
                  onPress={() => setShot({ ...f, caption: f.caption || todayCaption() })}
                >
                  <Image source={{ uri: f.uri }} style={styles.stripThumb} contentFit="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        // ---- Fullscreen viewfinder ----
        <View style={styles.finder}>
          <CameraView
            ref={setCameraRef}
            style={styles.camera}
            facing={facing}
            flash={flash}
            mirror={false}
            animateShutter
            onCameraReady={() => setCameraReady(true)}
            onMountError={() => setError('Camera would not start')}
          />
          {/* Square crop guide: the print is square, dim the rest. */}
          <View pointerEvents="none" style={[styles.dim, { top: 0, left: 0, right: 0, height: squareTop }]} />
          <View
            pointerEvents="none"
            style={[styles.dim, { top: squareTop + squareSize, left: 0, right: 0, bottom: 0 }]}
          />
          <View
            pointerEvents="none"
            style={[styles.dim, { top: squareTop, left: 0, width: squareLeft, height: squareSize }]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.dim,
              { top: squareTop, right: 0, width: squareLeft, height: squareSize },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.guide,
              { top: squareTop, left: squareLeft, width: squareSize, height: squareSize },
            ]}
          />
          {/* Live warmth hint so the viewfinder feels like the print. */}
          <View
            pointerEvents="none"
            style={[
              styles.liveTint,
              { top: squareTop, left: squareLeft, width: squareSize, height: squareSize },
            ]}
          />

          <View style={styles.topBar}>
            <Text style={styles.title}>POLAR</Text>
            <View style={styles.topButtons}>
              <TouchableOpacity
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`Flash ${flash}`}
                onPress={() => {
                  setFlash(FLASH_ORDER[(FLASH_ORDER.indexOf(flash) + 1) % FLASH_ORDER.length]);
                }}
              >
                <Ionicons name={FLASH_ICON[flash]} size={26} color="#f5f2e8" />
              </TouchableOpacity>
              <TouchableOpacity
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              >
                <Ionicons name="camera-reverse-outline" size={28} color="#f5f2e8" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.thumb}
              disabled={film.length === 0}
              onPress={() => {
                const last = film[0];
                if (last) {
                  setShot({ ...last, caption: last.caption || todayCaption() });
                }
              }}
            >
              {film[0] ? (
                <Image source={{ uri: film[0].uri }} style={styles.thumbImage} contentFit="cover" />
              ) : (
                <View style={styles.thumbEmpty} />
              )}
            </TouchableOpacity>
            <ShutterButton onPress={takePhoto} disabled={!cameraReady || working} />
            <View style={styles.thumbSpacer} />
          </View>

          {working && (
            <View style={styles.working}>
              <ActivityIndicator size="large" color="#f5f2e8" />
              <Text style={styles.hint}>Developing film…</Text>
            </View>
          )}
          {!!error && !working && (
            <View style={styles.errorWrap}>
              <Text style={styles.error}>{error}</Text>
            </View>
          )}
        </View>
      )}
      <StatusBar style="light" />
    </View>
  );
}

const TOP_PAD = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) + 12 : 60;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0e0e0f',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 6,
    color: '#f5f2e8',
  },
  hint: {
    fontSize: 13,
    color: '#8a8574',
    textAlign: 'center',
    marginTop: 8,
  },
  permList: {
    marginTop: 28,
    gap: 14,
    alignSelf: 'stretch',
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#3a382f',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  permText: {
    fontSize: 15,
    color: '#f5f2e8',
  },
  permNote: {
    marginTop: 16,
  },
  pill: {
    borderWidth: 1,
    borderColor: '#f5f2e8',
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginTop: 24,
  },
  pillText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f5f2e8',
  },
  pillPrimary: {
    backgroundColor: '#f5f2e8',
    borderColor: '#f5f2e8',
  },
  pillPrimaryText: {
    color: '#0e0e0f',
  },
  finder: {
    flex: 1,
  },
  camera: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  guide: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(245,242,232,0.6)',
  },
  liveTint: {
    position: 'absolute',
    backgroundColor: 'rgba(255,190,120,0.10)',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: TOP_PAD,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 44,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245,242,232,0.5)',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbEmpty: {
    flex: 1,
    backgroundColor: 'rgba(28,28,30,0.7)',
  },
  thumbSpacer: {
    width: 52,
  },
  working: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  errorWrap: {
    position: 'absolute',
    bottom: 130,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  error: {
    fontSize: 13,
    color: '#e08080',
  },
  result: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  resultButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  strip: {
    paddingTop: 18,
    gap: 10,
  },
  stripThumb: {
    width: 56,
    height: 56,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FAF6EC',
  },
});

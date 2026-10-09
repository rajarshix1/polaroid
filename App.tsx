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
import Constants from 'expo-constants';

// Lazy: importing expo-media-library warns (and is useless) in Expo Go,
// so it is only loaded on demand outside Go. Never import it statically.
const loadMediaLibrary = () => import('expo-media-library/legacy');
import { PolaroidCard } from './src/components/PolaroidCard';
import { ShutterButton } from './src/components/ShutterButton';
import { DevelopingPhoto } from './src/components/DevelopingPhoto';
import { LiveFilterOverlay } from './src/components/LiveFilterOverlay';
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
  // Manual media-library state: the usePermissions hook crashes in Expo Go
  // (its internal check rejects), so every call below is guarded.
  // In Expo Go the whole module is unavailable -> develop + show, no saving.
  const isExpoGo = Constants.appOwnership === 'expo';
  const [mediaState, setMediaState] = useState<{ granted: boolean } | null>(null);
  const mediaGranted = mediaState?.granted === true;

  const refreshMedia = useCallback(async () => {
    if (isExpoGo) {
      setMediaState({ granted: false });
      return false;
    }
    try {
      const ML = await loadMediaLibrary();
      const res = await ML.getPermissionsAsync(false, ['photo']);
      setMediaState({ granted: res.granted });
      return res.granted;
    } catch {
      setMediaState({ granted: false });
      return false;
    }
  }, [isExpoGo]);

  const requestMedia = useCallback(async () => {
    if (isExpoGo) {
      setMediaState({ granted: false });
      return false;
    }
    try {
      const ML = await loadMediaLibrary();
      const res = await ML.requestPermissionsAsync(false, ['photo']);
      setMediaState({ granted: res.granted });
      return res.granted;
    } catch {
      setMediaState({ granted: false });
      return false;
    }
  }, [isExpoGo]);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [cameraReady, setCameraReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [film, setFilm] = useState<Shot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);

  const { width } = Dimensions.get('window');
  // 4:3 viewfinder; the print is the centered square inside it.
  const previewWidth = width;
  const previewHeight = Math.floor((width * 4) / 3);
  const squareTop = Math.floor((previewHeight - previewWidth) / 2);
  const cardPhotoSize = Math.floor(width - 48);

  const camGranted = camPermission?.granted === true;

  // Ask for camera (+ storage outside Expo Go) the moment the app opens.
  const askAll = useCallback(async () => {
    try {
      if (!camGranted) {
        await requestCamPermission();
      }
    } catch {
      // Surfaced through the gate below.
    }
    if (!isExpoGo && !mediaGranted) {
      await requestMedia();
    } else if (isExpoGo) {
      setMediaState({ granted: false });
    }
    setAsked(true);
  }, [camGranted, mediaGranted, requestCamPermission, requestMedia, isExpoGo]);

  useEffect(() => {
    askAll();
  }, [askAll]);

  // Keep asking for the camera every time the user returns until granted.
  // Storage is soft: missing library access only disables auto-save, never blocks.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !camGranted) {
        askAll();
      }
    });
    return () => sub.remove();
  }, [askAll, camGranted]);

  const grantMedia = useCallback(() => {
    if (isExpoGo) {
      return;
    }
    refreshMedia().then((granted) => {
      if (!granted) {
        requestMedia();
      }
    });
  }, [isExpoGo, refreshMedia, requestMedia]);

  // Load the persistent Polar album for the film strip (dev builds only).
  useEffect(() => {
    if (isExpoGo || !mediaGranted) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ML = await loadMediaLibrary();
        const album = await ML.getAlbumAsync(ALBUM_TITLE).catch(() => null);
        if (!album) {
          return;
        }
        const { assets } = await ML.getAssetsAsync({
          album,
          first: 20,
          mediaType: 'photo',
          sortBy: [[ML.SortBy.creationTime, false]],
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
  }, [isExpoGo, mediaGranted]);

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
      // Saved straight into the album (never moved), so Android never asks to "modify".
      // Skipped in Expo Go, where the media library is unavailable.
      if (!isExpoGo) {
        try {
          if (!mediaGranted) {
            await requestMedia();
          }
          const ML = await loadMediaLibrary();
          const album =
            (await ML.getAlbumAsync(ALBUM_TITLE).catch(() => null)) ??
            (await ML.createAlbumAsync(ALBUM_TITLE).catch(() => null));
          await ML.createAssetAsync(finished.uri, album ?? undefined);
        } catch (e) {
          console.warn('Auto-save failed', e);
        }
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFilm((prev) => [finished, ...prev].slice(0, 20));
      setShot(finished);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setWorking(false);
    }
  }, [cameraRef, cameraReady, working, mediaGranted, requestMedia, isExpoGo]);

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

  // ---- Permission gate: camera is mandatory, storage is optional ----
  // (Expo Go cannot provide full media-library access, so missing photo
  // permission only disables auto-save instead of blocking the app.)
  if (!asked || !camPermission || !camGranted) {
    const needsSettings = !!camPermission && !camGranted && !camPermission.canAskAgain;
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
        </View>
        {asked && !camGranted && (
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
        {asked && !needsSettings && !camGranted && (
          <Text style={[styles.hint, styles.permNote]}>
            Polar cannot work without the camera — allow to continue.
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
          {!mediaGranted && (
            <TouchableOpacity style={styles.saveWarn} onPress={isExpoGo ? undefined : grantMedia}>
              <Ionicons name="images-outline" size={14} color="#e0b46a" />
              <Text style={styles.saveWarnText}>
                {isExpoGo ? 'Not saved — needs a dev build.' : 'Not saved to library. Tap to allow.'}
              </Text>
            </TouchableOpacity>
          )}
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
        // ---- 4:3 viewfinder over black ----
        <View style={styles.finder}>
          <View
            style={[styles.previewBox, { width: previewWidth, height: previewHeight }]}
          >
            <CameraView
              ref={setCameraRef}
              style={styles.camera}
              facing={facing}
              flash={flash}
              mirror={false}
              animateShutter
              onCameraReady={() => setCameraReady(true)}
              onMountError={() => setError('Camera would not start')}
              {...(Platform.OS === 'android' ? { ratio: '4:3' as const } : null)}
            />
            {/* Dim the 4:3 margins: the print is the centered square. */}
            <View
              pointerEvents="none"
              style={[styles.dim, { top: 0, left: 0, right: 0, height: squareTop }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.dim,
                { top: squareTop + previewWidth, left: 0, right: 0, bottom: 0 },
              ]}
            />
            {/* Live Polaroid grade on the square that becomes the print. */}
            <View pointerEvents="none" style={{ position: 'absolute', top: squareTop, left: 0 }}>
              <LiveFilterOverlay size={previewWidth} />
            </View>
            <View
              pointerEvents="none"
              style={[
                styles.guide,
                { top: squareTop, left: 0, width: previewWidth, height: previewWidth },
              ]}
            />
            <View style={styles.previewTop}>
              <Text style={styles.brand}>POLAR</Text>
              <TouchableOpacity
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`Flash ${flash}`}
                onPress={() => {
                  setFlash(FLASH_ORDER[(FLASH_ORDER.indexOf(flash) + 1) % FLASH_ORDER.length]);
                }}
              >
                <Ionicons name={FLASH_ICON[flash]} size={24} color="#f5f2e8" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.blackZone}>
            {!mediaGranted && (
              <TouchableOpacity style={styles.saveWarn} onPress={isExpoGo ? undefined : grantMedia}>
                <Ionicons name="images-outline" size={14} color="#e0b46a" />
                <Text style={styles.saveWarnText}>
                  {isExpoGo
                    ? 'Saving needs a dev build — prints stay in-app for now.'
                    : "Library blocked — prints won't save. Tap to allow."}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={styles.writeup}>600 FILM · POINT. SHOOT. PRINT.</Text>
            <View style={styles.controls}>
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
                  <Image
                    source={{ uri: film[0].uri }}
                    style={styles.thumbImage}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.thumbEmpty} />
                )}
              </TouchableOpacity>
              <ShutterButton onPress={takePhoto} disabled={!cameraReady || working} />
              <TouchableOpacity
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
                style={styles.iconButton}
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              >
                <Ionicons name="camera-reverse-outline" size={30} color="#f5f2e8" />
              </TouchableOpacity>
            </View>
            {!!error && !working && <Text style={styles.error}>{error}</Text>}
          </View>

          {working && (
            <View style={styles.working}>
              <ActivityIndicator size="large" color="#f5f2e8" />
              <Text style={styles.hint}>Developing film…</Text>
            </View>
          )}
        </View>
      )}
      <StatusBar style="light" />
    </View>
  );
}

const TOP_PAD = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) + 8 : 56;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000',
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
  brand: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 5,
    color: '#f5f2e8',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  hint: {
    fontSize: 13,
    color: '#8a8574',
    textAlign: 'center',
    marginTop: 8,
  },
  writeup: {
    fontSize: 12,
    letterSpacing: 3,
    color: '#8a8574',
    textAlign: 'center',
  },
  saveWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#6b5a33',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveWarnText: {
    fontSize: 12,
    color: '#e0b46a',
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
  previewBox: {
    marginTop: TOP_PAD,
    backgroundColor: '#111',
    overflow: 'hidden',
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
  previewTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  blackZone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 52,
    alignItems: 'center',
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
  error: {
    fontSize: 13,
    color: '#e08080',
  },
  result: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#0e0e0f',
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

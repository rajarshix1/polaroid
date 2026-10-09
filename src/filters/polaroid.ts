import { BlendMode, ImageFormat, Skia, TileMode } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

export interface DevelopedPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Max edge of the square photo area. Keeps grain + export fast. */
const MAX_PHOTO = 2048;
/** JPEG quality for the final framed print. */
const JPEG_QUALITY = 92;

/**
 * Polaroid 600 color science as a single 4x5 matrix (row-major, 0-1 floats).
 * Warm highlights, green-yellow mid shift, desaturated blues,
 * crushed contrast with blacks lifted to dark grey (the classic fade).
 */
const POLAROID_MATRIX = [
  0.811, 0.122, 0.012, 0, 0.112,
  0.034, 0.854, 0.012, 0, 0.095,
  0.032, 0.109, 0.705, 0, 0.081,
  0, 0, 0, 1, 0,
];

/** Deterministic PRNG so every shot gets unique, repeatable grain. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Develops a captured photo into a finished, framed Polaroid print:
 * center-square crop -> 600 color grade -> softness -> vignette ->
 * light leak -> film grain -> paper frame. Returns a JPEG file in cache.
 *
 * Throws on decode/render failure — callers should fall back to the raw shot.
 */
export async function developPolaroid(sourceUri: string): Promise<DevelopedPhoto> {
  const bytes = await new File(sourceUri).bytes();
  const data = Skia.Data.fromBytes(bytes);
  try {
    const src = Skia.Image.MakeImageFromEncoded(data);
    if (!src) {
      throw new Error('Could not decode captured photo');
    }
    try {
      return renderPrint(src);
    } finally {
      src.dispose();
    }
  } finally {
    data.dispose();
  }
}

function renderPrint(src: ReturnType<typeof Skia.Image.MakeImageFromEncoded> & object): DevelopedPhoto {
  const image = src as {
    width(): number;
    height(): number;
    dispose(): void;
  };
  const sw = image.width();
  const sh = image.height();
  if (sw <= 0 || sh <= 0) {
    throw new Error('Captured photo has no dimensions');
  }

  // Center-square crop, scaled down to MAX_PHOTO.
  const side = Math.min(sw, sh);
  const sx = Math.floor((sw - side) / 2);
  const sy = Math.floor((sh - side) / 2);
  const S = Math.min(side, MAX_PHOTO);

  // 600 frame geometry, proportional to photo edge.
  const marginSide = Math.round(S * 0.062);
  const marginTop = Math.round(S * 0.062);
  const marginBottom = Math.round(S * 0.21);
  const W = S + marginSide * 2;
  const H = S + marginTop + marginBottom;
  const px = marginSide;
  const py = marginTop;

  const surface = Skia.Surface.MakeOffscreen(W, H);
  if (!surface) {
    throw new Error('Could not create render surface');
  }
  try {
    const canvas = surface.getCanvas();

    // Paper.
    const paper = Skia.Paint();
    paper.setColor(Skia.Color('#FAF6EC'));
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), paper);

    // Graded photo with a whisper of optical softness.
    const photo = Skia.Paint();
    photo.setColorFilter(Skia.ColorFilter.MakeMatrix(POLAROID_MATRIX));
    photo.setImageFilter(Skia.ImageFilter.MakeBlur(0.7, 0.7, TileMode.Clamp));
    // drawImageRect is untyped loosely here; cast through the canvas type.
    (canvas as unknown as {
      drawImageRect(img: object, src: object, dst: object, paint: object): void;
    }).drawImageRect(
      image,
      Skia.XYWHRect(sx, sy, side, side),
      Skia.XYWHRect(px, py, S, S),
      photo,
    );

    // Inner print edge.
    const edge = Skia.Paint();
    edge.setColor(Skia.Color('rgba(60,40,20,0.10)'));
    canvas.drawRect(Skia.XYWHRect(px, py, S, 2), edge);
    canvas.drawRect(Skia.XYWHRect(px, py + S - 2, S, 2), edge);
    canvas.drawRect(Skia.XYWHRect(px, py, 2, S), edge);
    canvas.drawRect(Skia.XYWHRect(px + S - 2, py, 2, S), edge);

    // Vignette.
    const vignette = Skia.Paint();
    vignette.setShader(
      Skia.Shader.MakeRadialGradient(
        { x: px + S / 2, y: py + S / 2 },
        S * 0.72,
        [Skia.Color('rgba(0,0,0,0)'), Skia.Color('rgba(24,12,5,0.36)')],
        [0.55, 1],
        TileMode.Clamp,
      ),
    );
    canvas.drawRect(Skia.XYWHRect(px, py, S, S), vignette);

    // Light leak, top-right.
    const leak = Skia.Paint();
    leak.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: px + S, y: py },
        { x: px + S * 0.45, y: py + S * 0.55 },
        [Skia.Color('rgba(255,166,77,0.16)'), Skia.Color('rgba(255,166,77,0)')],
        null,
        TileMode.Clamp,
      ),
    );
    canvas.drawRect(Skia.XYWHRect(px, py, S, S), leak);

    // Warm wash.
    const wash = Skia.Paint();
    wash.setColor(Skia.Color('rgba(255,180,100,0.05)'));
    canvas.drawRect(Skia.XYWHRect(px, py, S, S), wash);

    // Film grain.
    const rand = mulberry32((Date.now() ^ (S * 7919)) >>> 0);
    const grain = Skia.Paint();
    grain.setBlendMode(BlendMode.Overlay);
    const black = Skia.Color('black');
    const white = Skia.Color('white');
    const count = Math.min(14000, Math.floor((S * S) / 380));
    const dot = S >= 1600 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const gx = px + Math.floor(rand() * S);
      const gy = py + Math.floor(rand() * S);
      const sz = rand() < 0.85 ? 1 : dot;
      grain.setColor(rand() > 0.5 ? white : black);
      grain.setAlphaf(0.05 + rand() * 0.09);
      canvas.drawRect(Skia.XYWHRect(gx, gy, sz, sz), grain);
    }

    const snapshot = surface.makeImageSnapshot();
    if (!snapshot) {
      throw new Error('Could not snapshot print');
    }
    try {
      const jpeg = snapshot.encodeToBytes(ImageFormat.JPEG, JPEG_QUALITY);
      const out = new File(Paths.cache, `polar-${Date.now()}.jpg`);
      out.write(jpeg);
      return { uri: out.uri, width: W, height: H };
    } finally {
      snapshot.dispose();
    }
  } finally {
    surface.dispose();
  }
}

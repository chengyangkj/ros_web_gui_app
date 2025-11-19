interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function SRGBToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

export function stringToRgba(output: ColorRGBA, colorStr: string): ColorRGBA {
  const rgbaMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    output.r = parseInt(rgbaMatch[1]!) / 255;
    output.g = parseInt(rgbaMatch[2]!) / 255;
    output.b = parseInt(rgbaMatch[3]!) / 255;
    output.a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
    return output;
  }

  const hexMatch = colorStr.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    if (hex.length === 3) {
      output.r = parseInt(hex[0]! + hex[0]!, 16) / 255;
      output.g = parseInt(hex[1]! + hex[1]!, 16) / 255;
      output.b = parseInt(hex[2]! + hex[2]!, 16) / 255;
      output.a = 1;
    } else if (hex.length === 6) {
      output.r = parseInt(hex.substring(0, 2), 16) / 255;
      output.g = parseInt(hex.substring(2, 4), 16) / 255;
      output.b = parseInt(hex.substring(4, 6), 16) / 255;
      output.a = 1;
    } else if (hex.length === 8) {
      output.r = parseInt(hex.substring(0, 2), 16) / 255;
      output.g = parseInt(hex.substring(2, 4), 16) / 255;
      output.b = parseInt(hex.substring(4, 6), 16) / 255;
      output.a = parseInt(hex.substring(6, 8), 16) / 255;
    }
    return output;
  }

  output.r = output.g = output.b = output.a = 1;
  return output;
}

export function rgbaToCssString(color: ColorRGBA): string {
  const r = Math.trunc(color.r * 255);
  const g = Math.trunc(color.g * 255);
  const b = Math.trunc(color.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${color.a})`;
}

export function srgbToLinearUint8(color: ColorRGBA): void {
  color.r = Math.trunc(SRGBToLinear(color.r) * 255);
  color.g = Math.trunc(SRGBToLinear(color.g) * 255);
  color.b = Math.trunc(SRGBToLinear(color.b) * 255);
  color.a = Math.trunc(color.a * 255);
}

export type ColorModes = 'custom' | 'costmap' | 'map' | 'raw';

let costmapPalette: [number, number, number, number][] | undefined;
let mapPalette: [number, number, number, number][] | undefined;
let rawPalette: [number, number, number, number][] | undefined;

function createMapPalette(): [number, number, number, number][] {
  let index = 0;
  const palette: [number, number, number, number][] = new Array(256).fill([0, 0, 0, 0]);

  for (let i = 0; i <= 100; i++) {
    const v = Math.trunc(255 - (255 * i) / 100);
    palette[index++] = [v, v, v, 255];
  }

  for (let i = 101; i <= 127; i++) {
    palette[index++] = [0, 255, 0, 255];
  }

  for (let i = 128; i <= 254; i++) {
    palette[index++] = [255, Math.trunc((255 * (i - 128)) / (254 - 128)), 0, 255];
  }

  palette[index++] = [112, 137, 134, 255];
  return palette;
}

function createCostmapPalette(): [number, number, number, number][] {
  let index = 0;
  const palette: [number, number, number, number][] = new Array(256).fill([0, 0, 0, 0]);

  palette[index++] = [0, 0, 0, 0];

  for (let i = 1; i <= 98; i++) {
    const v = Math.trunc((255 * i) / 100);
    palette[index++] = [v, 0, 255 - v, 255];
  }

  palette[index++] = [0, 255, 255, 255];
  palette[index++] = [255, 0, 255, 255];

  for (let i = 101; i <= 127; i++) {
    palette[index++] = [0, 255, 0, 255];
  }

  for (let i = 128; i <= 254; i++) {
    palette[index++] = [255, Math.trunc((255 * (i - 128)) / (254 - 128)), 0, 255];
  }

  palette[index++] = [112, 137, 134, 255];
  return palette;
}

function createRawPalette(): [number, number, number, number][] {
  let index = 0;
  const palette: [number, number, number, number][] = new Array(256).fill([0, 0, 0, 0]);

  for (let i = 0; i < 256; i++) {
    palette[index++] = [i, i, i, 255];
  }

  return palette;
}

export function paletteColorCached(
  output: ColorRGBA,
  value: number,
  paletteColorMode: 'costmap' | 'map' | 'raw',
): void {
  const unsignedValue = value >= 0 ? value : value + 256;
  if (unsignedValue < 0 || unsignedValue > 255) {
    output.r = 0;
    output.g = 0;
    output.b = 0;
    output.a = 0;
    return;
  }

  let palette: [number, number, number, number][] | undefined;
  switch (paletteColorMode) {
    case 'costmap':
      if (!costmapPalette) {
        costmapPalette = createCostmapPalette();
      }
      palette = costmapPalette;
      break;
    case 'map':
      if (!mapPalette) {
        mapPalette = createMapPalette();
      }
      palette = mapPalette;
      break;
    case 'raw':
      if (!rawPalette) {
        rawPalette = createRawPalette();
      }
      palette = rawPalette;
      break;
    default:
      if (!rawPalette) {
        rawPalette = createRawPalette();
      }
      palette = rawPalette;
  }

  const colorRaw = palette[Math.trunc(unsignedValue)]!;
  output.r = colorRaw[0];
  output.g = colorRaw[1];
  output.b = colorRaw[2];
  output.a = colorRaw[3];
}


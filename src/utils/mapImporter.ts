import JSZip from 'jszip';
import type { TopologyMap } from './MapManager';

interface OccupancyGrid {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nsec: number;
    };
  };
  info: {
    map_load_time: {
      sec: number;
      nsec: number;
    };
    resolution: number;
    width: number;
    height: number;
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[] | Int8Array;
}

interface ImportResult {
  occupancyGrid: OccupancyGrid | null;
  topologyMap: TopologyMap | null;
}

export async function importMap(file: File): Promise<ImportResult> {
  const zip = new JSZip();
  const arrayBuffer = await file.arrayBuffer();
  const zipData = await zip.loadAsync(arrayBuffer);

  let occupancyGrid: OccupancyGrid | null = null;
  let topologyMap: TopologyMap | null = null;

  for (const [filename, fileData] of Object.entries(zipData.files)) {
    if (fileData.dir) continue;

    if (filename.endsWith('.pgm')) {
      const yamlFilename = filename.replace('.pgm', '.yaml');
      const yamlFile = zipData.files[yamlFilename];
      
      if (yamlFile) {
        const pgmData = await fileData.async('uint8array');
        const yamlContent = await yamlFile.async('string');
        occupancyGrid = parsePGMAndYAML(pgmData, yamlContent);
      }
    } else if (filename.endsWith('.topology')) {
      const topologyContent = await fileData.async('string');
      try {
        topologyMap = JSON.parse(topologyContent) as TopologyMap;
      } catch (error) {
        console.error('Failed to parse topology file:', error);
      }
    }
  }

  return { occupancyGrid, topologyMap };
}

function parsePGMAndYAML(pgmData: Uint8Array, yamlContent: string): OccupancyGrid {
  const yamlLines = yamlContent.split('\n');
  let resolution = 0.05;
  let originX = 0;
  let originY = 0;
  let originZ = 0;
  let imagePath = '';

  for (const line of yamlLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('resolution:')) {
      resolution = parseFloat(trimmed.split(':')[1].trim());
    } else if (trimmed.startsWith('origin:')) {
      const originMatch = trimmed.match(/\[([^\]]+)\]/);
      if (originMatch) {
        const coords = originMatch[1].split(',').map(s => parseFloat(s.trim()));
        originX = coords[0] || 0;
        originY = coords[1] || 0;
        originZ = coords[2] || 0;
      }
    } else if (trimmed.startsWith('image:')) {
      imagePath = trimmed.split(':')[1].trim();
    }
  }

  let headerEnd = 0;
  let width = 0;
  let height = 0;
  let maxVal = 255;

  for (let i = 0; i < pgmData.length; i++) {
    if (pgmData[i] === 0x0A) {
      const line = String.fromCharCode(...Array.from(pgmData.slice(headerEnd, i)));
      if (line.startsWith('P5')) {
        headerEnd = i + 1;
      } else if (line.match(/^\d+ \d+$/)) {
        const parts = line.split(' ');
        width = parseInt(parts[0], 10);
        height = parseInt(parts[1], 10);
        headerEnd = i + 1;
      } else if (line.match(/^\d+$/)) {
        maxVal = parseInt(line, 10);
        headerEnd = i + 1;
        break;
      }
    }
  }

  while (headerEnd < pgmData.length && pgmData[headerEnd] === 0x0A) {
    headerEnd++;
  }

  const imageData = pgmData.slice(headerEnd);
  const data: number[] = new Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcY = height - 1 - y;
      const srcIndex = srcY * width + x;
      const dstIndex = y * width + x;
      
      if (srcIndex < imageData.length) {
        const pixelValue = imageData[srcIndex];
        if (pixelValue === 254) {
          data[dstIndex] = 0;
        } else if (pixelValue === 0) {
          data[dstIndex] = 100;
        } else if (pixelValue === 205) {
          data[dstIndex] = -1;
        } else {
          const ratio = pixelValue / 255.0;
          if (ratio < 0.196) {
            data[dstIndex] = 0;
          } else if (ratio > 0.65) {
            data[dstIndex] = 100;
          } else {
            data[dstIndex] = -1;
          }
        }
      } else {
        data[dstIndex] = -1;
      }
    }
  }

  const now = Date.now();
  const occupancyGrid: OccupancyGrid = {
    header: {
      frame_id: 'map',
      stamp: {
        sec: Math.floor(now / 1000),
        nsec: (now % 1000) * 1000000,
      },
    },
    info: {
      map_load_time: {
        sec: Math.floor(now / 1000),
        nsec: (now % 1000) * 1000000,
      },
      resolution,
      width,
      height,
      origin: {
        position: { x: originX, y: originY, z: originZ },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data,
  };

  return occupancyGrid;
}


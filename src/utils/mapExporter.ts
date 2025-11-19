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

export async function exportMap(
  occupancyGrid: OccupancyGrid | null,
  topologyMap: TopologyMap | null,
  mapName: string
): Promise<void> {
  const zip = new JSZip();

  if (occupancyGrid) {
    const pgmData = generatePGM(occupancyGrid);
    const yamlContent = generateYAML(occupancyGrid, mapName);
    
    zip.file(`${mapName}.pgm`, pgmData);
    zip.file(`${mapName}.yaml`, yamlContent);
  }

  if (topologyMap && topologyMap.points && topologyMap.points.length > 0) {
    const topologyContent = JSON.stringify(topologyMap, null, 2);
    zip.file(`${mapName}.topology`, topologyContent);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mapName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generatePGM(occupancyGrid: OccupancyGrid): Uint8Array {
  const { info, data } = occupancyGrid;
  const width = info.width;
  const height = info.height;
  const resolution = info.resolution;
  
  const header = `P5\n# CREATOR: map_saver.cpp ${resolution.toFixed(3)} m/pix\n${width} ${height}\n255\n`;
  const headerBytes = new TextEncoder().encode(header);
  
  const imageData = new Uint8Array(headerBytes.length + width * height);
  imageData.set(headerBytes, 0);
  
  const dataArray = Array.isArray(data) ? data : Array.from(data);
  const freeThresh = 0.196 * 100;
  const occupiedThresh = 0.65 * 100;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcY = height - 1 - y;
      const srcIndex = srcY * width + x;
      const dstIndex = y * width + x;
      const value = dataArray[srcIndex] ?? -1;
      
      let pixelValue: number;
      if (value === -1) {
        pixelValue = 205;
      } else if (value >= 0 && value <= freeThresh) {
        pixelValue = 254;
      } else if (value >= occupiedThresh) {
        pixelValue = 0;
      } else {
        pixelValue = 205;
      }
      
      imageData[headerBytes.length + dstIndex] = pixelValue;
    }
  }
  
  return imageData;
}

function generateYAML(occupancyGrid: OccupancyGrid, mapName: string): string {
  const { info } = occupancyGrid;
  const resolution = info.resolution;
  const origin = info.origin.position;
  
  const yaml = `image: ./${mapName}.pgm
resolution: ${resolution.toFixed(6)}
origin: [${origin.x.toFixed(6)}, ${origin.y.toFixed(6)}, ${origin.z.toFixed(6)}]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.196
mode: trinary
`;
  
  return yaml;
}

const DB_NAME = 'ros_web_gui_urdf_db';
const DB_VERSION = 1;
const STORE_NAME = 'urdf_files';

let dbInstance: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveUrdfFile(fileName: string, content: string | ArrayBuffer): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.put(content, fileName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to save URDF file:', error);
    throw error;
  }
}

export async function loadUrdfFile(fileName: string): Promise<string | ArrayBuffer | null> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    return new Promise<string | ArrayBuffer | null>((resolve, reject) => {
      const request = store.get(fileName);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to load URDF file:', error);
    return null;
  }
}

export async function deleteUrdfFile(fileName: string): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(fileName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to delete URDF file:', error);
    throw error;
  }
}

export async function getAllUrdfFileNames(): Promise<string[]> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    return new Promise<string[]>((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result.map(key => String(key)));
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to get URDF file names:', error);
    return [];
  }
}

export function createBlobUrl(content: string | ArrayBuffer, mimeType: string): string {
  const blob = new Blob([content], { type: mimeType });
  return URL.createObjectURL(blob);
}

export async function saveUrdfFiles(files: Map<string, string | ArrayBuffer>): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const promises = Array.from(files.entries()).map(([fileName, content]) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.put(content, fileName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
    
    await Promise.all(promises);
  } catch (error) {
    console.error('Failed to save URDF files:', error);
    throw error;
  }
}

export async function getFileUrl(fileName: string): Promise<string | null> {
  const content = await loadUrdfFile(fileName);
  if (!content) return null;
  
  if (typeof content === 'string') {
    return createBlobUrl(content, 'application/xml');
  } else {
    return createBlobUrl(content, 'application/octet-stream');
  }
}


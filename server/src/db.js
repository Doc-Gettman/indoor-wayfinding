import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
export const BUILDINGS_FILE = path.join(DATA_DIR, 'buildings.json');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
}

export function buildingDir(buildingId) {
  return path.join(DATA_DIR, 'buildings', buildingId);
}

function collectionFile(buildingId, name) {
  return path.join(buildingDir(buildingId), `${name}.json`);
}

export async function listBuildings() {
  return readJson(BUILDINGS_FILE, []);
}

export async function saveBuildings(buildings) {
  await writeJson(BUILDINGS_FILE, buildings);
}

export async function getCollection(buildingId, name) {
  return readJson(collectionFile(buildingId, name), []);
}

export async function saveCollection(buildingId, name, data) {
  await writeJson(collectionFile(buildingId, name), data);
}

export async function buildingImagesDir(buildingId) {
  const dir = path.join(IMAGES_DIR, 'buildings', buildingId, 'floors');
  await ensureDir(dir);
  return dir;
}

let idCounter = Date.now();
export function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}`;
}

// One-time migration: copies server/data/** (local JSON files + uploaded
// floorplan images) into Supabase (Postgres + Storage). Safe to re-run —
// every write is an upsert, and the source of truth is always local disk.
//
// Usage (from server/): node scripts/migrate-to-supabase.js
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

const COLLECTION_NAMES = ['floors', 'nodes', 'edges', 'pois', 'landmarks', 'qrcodes'];
const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function migrateFloorImages(buildingId, floors) {
  for (const floor of floors) {
    if (!floor.imagePath) continue;
    const ext = path.extname(floor.imagePath);
    const localFile = path.join(IMAGES_DIR, floor.imagePath.replace(/^\/images\//, ''));
    let buffer;
    try {
      buffer = await fs.readFile(localFile);
    } catch (err) {
      console.warn(`  ! skipping missing image for floor ${floor.id}: ${localFile}`);
      continue;
    }
    const storagePath = `buildings/${buildingId}/floors/${floor.id}${ext}`;
    const { error } = await supabase.storage
      .from('floor-images')
      .upload(storagePath, buffer, { contentType: CONTENT_TYPES[ext] || 'application/octet-stream', upsert: true });
    if (error) throw new Error(`Storage upload failed for ${storagePath}: ${error.message}`);
    const {
      data: { publicUrl },
    } = supabase.storage.from('floor-images').getPublicUrl(storagePath);
    floor.imagePath = publicUrl;
    console.log(`  uploaded image for floor ${floor.id}`);
  }
  return floors;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see server/.env)');
  }

  const buildings = await readJson(path.join(DATA_DIR, 'buildings.json'), []);
  console.log(`Migrating ${buildings.length} building(s)...`);

  if (buildings.length) {
    const { error } = await supabase.from('buildings').upsert(buildings);
    if (error) throw new Error(`Failed to upsert buildings: ${error.message}`);
  }

  for (const building of buildings) {
    console.log(`\n${building.id} (${building.name})`);
    for (const name of COLLECTION_NAMES) {
      const file = path.join(DATA_DIR, 'buildings', building.id, `${name}.json`);
      let data = await readJson(file, []);
      if (name === 'floors') {
        data = await migrateFloorImages(building.id, data);
      }
      const { error } = await supabase
        .from('building_collections')
        .upsert({ building_id: building.id, name, data, updated_at: new Date().toISOString() });
      if (error) throw new Error(`Failed to upsert ${name} for ${building.id}: ${error.message}`);
      console.log(`  ${name}: ${data.length} record(s)`);
    }
  }

  console.log('\nMigration complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

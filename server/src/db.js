import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function listBuildings() {
  const { data, error } = await supabase.from('buildings').select('id, name').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function saveBuildings(buildings) {
  const { error: deleteError } = await supabase.from('buildings').delete().not('id', 'is', null);
  if (deleteError) throw deleteError;
  if (buildings.length) {
    const { error: insertError } = await supabase.from('buildings').insert(buildings);
    if (insertError) throw insertError;
  }
}

export async function getCollection(buildingId, name) {
  const { data, error } = await supabase
    .from('building_collections')
    .select('data')
    .eq('building_id', buildingId)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return data?.data ?? [];
}

export async function saveCollection(buildingId, name, data) {
  const { error } = await supabase
    .from('building_collections')
    .upsert({ building_id: buildingId, name, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export function nextId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

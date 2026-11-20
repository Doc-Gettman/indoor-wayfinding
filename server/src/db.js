import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { invalidateRouteCache } from './lib/routeCache.js';

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Building groups aren't tied to any one building, so they're stored under
// this sentinel scope in the same building_collections table rather than a
// dedicated table (no schema migration required).
const SYSTEM_SCOPE = '__system__';

export async function listGroups() {
  return getCollection(SYSTEM_SCOPE, 'groups');
}

export async function saveGroups(groups) {
  await saveCollection(SYSTEM_SCOPE, 'groups', groups);
}

export async function listBuildings() {
  const { data, error } = await supabase.from('buildings').select('id, name').order('name');
  if (error) throw error;
  const buildings = data ?? [];
  const groups = await listGroups();
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  return Promise.all(
    buildings.map(async (building) => {
      const metadata = await getBuildingMetadata(building.id);
      const groupId = metadata.groupId || null;
      return { ...building, groupId, groupName: (groupId && groupsById.get(groupId)?.name) || null };
    }),
  );
}

export async function saveBuildings(buildings) {
  const { error: deleteError } = await supabase.from('buildings').delete().not('id', 'is', null);
  if (deleteError) throw deleteError;
  if (buildings.length) {
    const rows = buildings.map(({ id, name }) => ({ id, name }));
    const { error: insertError } = await supabase.from('buildings').insert(rows);
    if (insertError) throw insertError;
  }
}

export async function getBuildingMetadata(buildingId) {
  const [metadata] = await getCollection(buildingId, 'metadata');
  return metadata ?? {};
}

export async function saveBuildingMetadata(buildingId, metadata) {
  await saveCollection(buildingId, 'metadata', [metadata]);
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
  invalidateRouteCache(buildingId);
}

// Usage tracking — see server/sql/direction_requests.sql for the table.
export async function recordDirectionRequest(row) {
  const { error } = await supabase.from('direction_requests').insert(row);
  if (error) throw error;
}

// Supabase caps each select at 1000 rows by default, so page through the
// range rather than silently truncating busy buildings' reports.
const REQUEST_PAGE_SIZE = 1000;

export async function listDirectionRequests({ buildingIds, since, until }) {
  if (!buildingIds.length) return [];
  const rows = [];
  for (let offset = 0; ; offset += REQUEST_PAGE_SIZE) {
    let query = supabase
      .from('direction_requests')
      .select('id, created_at, building_id, origin_node_id, qr_code_id, qr_label, destination_poi_id, destination_name, avoid_stairs')
      .in('building_id', buildingIds)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + REQUEST_PAGE_SIZE - 1);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lt('created_at', until);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < REQUEST_PAGE_SIZE) return rows;
  }
}

export function nextId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

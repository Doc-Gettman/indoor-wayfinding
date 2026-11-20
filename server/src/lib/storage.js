import { supabase } from '../db.js';

// Public bucket for admin-uploaded images: floorplans (buildings/...) and
// group splash-screen images (groups/...). The name predates splash images.
export const IMAGE_BUCKET = 'floor-images';
export const ALLOWED_IMAGE_TYPES = /^image\/(png|jpe?g|webp)$/;

// Image URLs are public storage URLs like
// `${SUPABASE_URL}/storage/v1/object/public/floor-images/<storagePath>?v=<cache-buster>`.
// Pull the storagePath back out so we can remove the underlying file.
export function storagePathFromImageUrl(imageUrl) {
  const marker = `/${IMAGE_BUCKET}/`;
  const markerIndex = String(imageUrl || '').indexOf(marker);
  if (markerIndex === -1) return null;
  return imageUrl.slice(markerIndex + marker.length).split('?')[0];
}

export async function removeStorageImage(imageUrl) {
  const storagePath = storagePathFromImageUrl(imageUrl);
  if (!storagePath) return;
  await supabase.storage.from(IMAGE_BUCKET).remove([storagePath]);
}

// Returns a short-lived signed URL the browser uploads the image bytes to
// directly, bypassing the API's own request body (Vercel's serverless
// functions cap request bodies well under typical image sizes).
export async function createImageUploadUrl(storagePath) {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUploadUrl(storagePath, { upsert: true });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath);
  return { signedUrl: data.signedUrl, token: data.token, path: storagePath, publicUrl };
}

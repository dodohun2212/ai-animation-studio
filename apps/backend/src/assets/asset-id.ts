import { unsafeAssetId } from "./asset-api.error.js";

// Python accepts the ASSET-/FOLDER- namespaces. Keep legacy suffixes while
// excluding separators, dots, controls, whitespace and URL traversal forms.
const SAFE_ASSET_ID = /^(?:ASSET|FOLDER)-[A-Z0-9][A-Z0-9_-]{0,98}$/;

export function isSafeAssetId(assetId: string): boolean { return SAFE_ASSET_ID.test(assetId); }

export function assertSafeAssetId(assetId: string): string {
  if (!isSafeAssetId(assetId)) throw unsafeAssetId();
  return assetId;
}

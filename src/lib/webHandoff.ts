/**
 * Mobile → web growth contract (backend MOBILE-WEB-GROWTH-CONTRACT.md).
 * Opens a richer full-posture SecURL scan of a target in the hosted web app.
 * UTMs are aggregate + privacy-safe: they never carry the host, user, or device.
 */
import { Linking } from 'react-native';

const WEB_BASE = 'https://app.securl.online';
const SOURCE = 'header_watch_ios';

function normalize(target: string): string {
  const t = target.trim();
  return t.startsWith('http') ? t : `https://${t}`;
}

export function scanHandoffUrl(target: string): string {
  return `${WEB_BASE}/?url=${encodeURIComponent(normalize(target))}` +
    `&utm_source=${SOURCE}&utm_medium=app&utm_campaign=mobile_handoff`;
}

/** Open the scanner handoff in the browser. Best-effort. */
export async function openScanHandoff(target: string): Promise<void> {
  try {
    await Linking.openURL(scanHandoffUrl(target));
  } catch {
    // Non-fatal.
  }
}

/**
 * Link used when a user shares a watch's status with someone else (native share
 * sheet, not the in-app web handoff above). Distinct utm_campaign so this is
 * attributable separately from the scan-handoff CTA. Same privacy-safe UTM
 * convention: aggregate + never carries the host, user, or device.
 */
export function shareWatchUrl(target: string): string {
  return `${WEB_BASE}/?url=${encodeURIComponent(normalize(target))}` +
    `&utm_source=${SOURCE}&utm_medium=app&utm_campaign=mobile_shared_watch`;
}

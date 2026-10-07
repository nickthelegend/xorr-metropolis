/**
 * webFocus.ts — what a focused text field looks like on the web (2026-10-07).
 *
 * A browser draws its own focus outline on an input: on this app, a square blue rectangle around a rounded black field
 * (the screen review found it on Search, and it is on every field). The outline is not removed — a focused field must
 * still say it is focused — it is redrawn in the accent and follows the field's corners.
 *
 * Added through the stylesheet React Native Web already owns (CSSOM `insertRule`), because the page's content security
 * policy refuses a `<style>` element this app adds itself.
 */
import { Platform } from 'react-native';
import { colors } from './tokens';

let installed = false;

export function installWebFocusRing(): void {
  if (installed || Platform.OS !== 'web' || typeof document === 'undefined') return;
  const sheets = Array.from(document.styleSheets);
  const sheet = sheets.find((s) => (s.ownerNode as HTMLElement | null)?.id === 'react-native-stylesheet') ?? sheets[0];
  if (!sheet) return;
  try {
    sheet.insertRule(
      `input:focus, textarea:focus { outline: none !important; box-shadow: 0 0 0 2px ${colors.accentLine} !important; }`,
      sheet.cssRules.length,
    );
    installed = true;
  } catch {
    // A sheet that refuses the rule leaves the browser's own outline, which is still a focus ring.
  }
}

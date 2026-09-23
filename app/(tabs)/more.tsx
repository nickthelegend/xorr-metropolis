/**
 * The grid tab — intentionally blank (2026-09-12).
 *
 * A grid of tiles stood here and was not what the product owner wants for this tab, so it is empty
 * until that is decided. The button stays in the bar; the screen draws only the ground.
 */
import React from 'react';
import { Redirect } from 'expo-router';

/*
 * The bar has lost this button since (Home, Trade, Messages), so the blank screen was reachable only by typing its URL,
 * and it was a dead end with nothing on it and no way on. It goes Home until the tab is decided (2026-09-24).
 */
export default function More() {
  return <Redirect href="/" />;
}

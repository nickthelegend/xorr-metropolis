/** A venue's name from its address, as the executor names it; the address where it is not one of ours. */
export function venueName(address: string, env: NodeJS.ProcessEnv = process.env): string {
  const a = address.toLowerCase();
  if (env.ENVIO_KURU_VENUE && a === env.ENVIO_KURU_VENUE.toLowerCase()) return 'Kuru';
  if (env.ENVIO_UNISWAP_ROUTER && a === env.ENVIO_UNISWAP_ROUTER.toLowerCase()) return 'Uniswap v3';
  return address;
}

/** The UTC day of a block's time, yyyy-mm-dd. */
export function utcDay(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

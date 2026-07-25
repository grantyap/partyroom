export function replaceUrlOrigin(value: string, origin: string) {
  const source = new URL(value);
  return new URL(`${source.pathname}${source.search}${source.hash}`, origin).toString();
}

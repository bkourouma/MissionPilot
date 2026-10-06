/** Remplace le nom de base par `<nom>_test`. */
export function urlBaseTest(url: string): string {
  const u = new URL(url);
  const nom = u.pathname.slice(1);
  u.pathname = `/${nom.endsWith("_test") ? nom : `${nom}_test`}`;
  return u.toString();
}

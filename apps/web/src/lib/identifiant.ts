/** Identifiant d'URL attendu par l'API (UUID) ; tout autre segment mène à une page 404. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function estIdentifiant(v: string): boolean {
  return UUID.test(v);
}

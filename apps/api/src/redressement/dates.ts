/*
 * Dates du redressement. Le jour courant (UTC) est la date de référence des calculs qui en
 * dépendent (situation des créanciers, retard d'une action, score) : jamais une horloge dans le
 * moteur, qui la reçoit en paramètre.
 */
export const dateDuJour = (): string => new Date().toISOString().slice(0, 10);

/**
 * Semaines calendaires (logique pure, testée dans `semaine.test.ts`) : lecture d'un paramètre
 * `?semaine=`, navigation d'une semaine à l'autre et libellés des jours. Ce sont des opérations
 * de calendrier (dates civiles, en UTC), pas des chiffres métier : capacité, jours ouvrés et
 * jours alloués viennent toujours de l'API.
 */

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const JOUR_MS = 86_400_000;

/** Date AAAA-MM-JJ valide (le 31 février est refusé), entre 2000 et 2100. */
export function estDateIso(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE_ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3]) &&
    v >= "2000-01-01" &&
    v <= "2100-12-31"
  );
}

/** Paramètre `?semaine=` d'une URL → date ISO, ou `undefined` (semaine courante côté API). */
export function lireSemaine(v: string | string[] | undefined): string | undefined {
  const brut = Array.isArray(v) ? v[0] : v;
  return estDateIso(brut) ? brut : undefined;
}

/** Ajoute (ou retire) des jours calendaires à une date ISO. */
export function ajouterJoursIso(date: string, n: number): string {
  const m = DATE_ISO.exec(date);
  if (!m) return date;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + n * JOUR_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Les sept dates (lundi → dimanche) d'une semaine dont on connaît le lundi. */
export function joursDeLaSemaine(lundi: string): string[] {
  return Array.from({ length: 7 }, (_, i) => ajouterJoursIso(lundi, i));
}

/** Lundi de la semaine d'une date ISO (semaine du lundi au dimanche). */
export function lundiDe(date: string): string {
  const m = DATE_ISO.exec(date);
  if (!m) return date;
  const jour = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return ajouterJoursIso(date, -((jour + 6) % 7));
}

/** Date du jour (UTC, comme l'API). */
export const aujourdhuiIso = (maintenant: Date = new Date()) =>
  maintenant.toISOString().slice(0, 10);

const NOM_JOUR = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" });
const NOM_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" });
const JOUR_MOIS = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const JOUR_MOIS_COURT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function versDate(date: string): Date | null {
  const m = DATE_ISO.exec(date);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « Lundi 5 octobre » (titre d'un jour, nom accessible d'un champ). */
export function libelleJourLong(date: string): string {
  const d = versDate(date);
  return d ? majuscule(`${NOM_JOUR.format(d)} ${JOUR_MOIS.format(d)}`) : date;
}

/** « lun. 5 » (en-tête compact d'une colonne). */
export function libelleJourCourt(date: string): string {
  const d = versDate(date);
  if (!d) return date;
  return `${NOM_JOUR_COURT.format(d)} ${d.getUTCDate()}`;
}

/** « Semaine du 5 au 11 octobre 2026 » (mois et année répétés seulement s'ils changent). */
export function libelleSemaine(debut: string, fin: string): string {
  const d = versDate(debut);
  const f = versDate(fin);
  if (!d || !f) return `Semaine du ${debut} au ${fin}`;
  const memeMois = d.getUTCMonth() === f.getUTCMonth() && d.getUTCFullYear() === f.getUTCFullYear();
  const memeAnnee = d.getUTCFullYear() === f.getUTCFullYear();
  const gauche = memeMois
    ? String(d.getUTCDate())
    : memeAnnee
      ? JOUR_MOIS.format(d)
      : `${JOUR_MOIS.format(d)} ${d.getUTCFullYear()}`;
  return `Semaine du ${gauche} au ${JOUR_MOIS.format(f)} ${f.getUTCFullYear()}`;
}

/** « 5 oct. » : date courte sans année. */
export function libelleDateCourte(date: string): string {
  const d = versDate(date);
  return d ? JOUR_MOIS_COURT.format(d) : date;
}

/** Vrai si la date tombe dans la période [debut ; fin] (bornes incluses). */
export const dansPeriode = (date: string, debut: string, fin: string) =>
  date >= debut && date <= fin;

/** Liens de navigation d'une semaine : précédente, suivante, et semaine courante si ailleurs. */
export function navigationSemaine(
  base: string,
  lundi: string,
  aujourdhui: string,
  extra: Record<string, string> = {},
): { precedente: string; suivante: string; courante: string | null } {
  const href = (semaine: string | null) => {
    const p = new URLSearchParams(extra);
    if (semaine) p.set("semaine", semaine);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  return {
    precedente: href(ajouterJoursIso(lundi, -7)),
    suivante: href(ajouterJoursIso(lundi, 7)),
    courante: lundiDe(aujourdhui) === lundi ? null : href(null),
  };
}

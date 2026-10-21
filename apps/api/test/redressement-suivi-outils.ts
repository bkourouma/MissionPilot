import type { Db } from "../src/db/pool.js";
import type { Contexte } from "./helpers.js";
import { proprietaire } from "./helpers.js";
import { creerMission, creerMissionSignee, type ApiUtilisateur } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import { ouvrirDossierRed, type ScenarioRed } from "./redressement-outils.js";

/*
 * Outils des tests du suivi post-mission (RED-09, lot 2) : dossiers clos (à la date du jour, ou
 * dans le passé par le rôle propriétaire pour éprouver les retards), dates attendues calculées
 * indépendamment du moteur, accès SQL qui rend le SQLSTATE d'un refus.
 */

export const urlS = (dossierId: string, suffixe = ""): string =>
  `/api/redressement/dossiers/${dossierId}/suivi${suffixe}`;

export const aujourdhui = (): string => new Date().toISOString().slice(0, 10);

/** Ajoute des mois à une date ISO (jour ramené à la fin du mois), sans passer par le moteur. */
export function plusMois(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + n;
  const annee = Math.floor(index / 12);
  const mois = index - annee * 12 + 1;
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return new Date(Date.UTC(annee, mois - 1, Math.min(d, dernier))).toISOString().slice(0, 10);
}

export const plusJours = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Jours de `a` à `b` (positif si `b` suit `a`). */
export const ecartJours = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface OptionsDossierClos {
  /** Membres d'équipe à ajouter à la mission. */
  equipe?: ApiUtilisateur[];
  /** Clôture dans le passé (propriétaire) : nombre de jours avant aujourd'hui. */
  joursDepuisCloture?: number;
  /** Mission signée (pour la clôturer ensuite). */
  signee?: boolean;
  /** Ne pas clore le dossier. */
  ouvert?: boolean;
}

/** Mission et dossier de redressement neufs, clos par défaut (jour courant, par l'API). */
export async function nouveauDossierSuivi(
  s: ScenarioRed,
  intitule: string,
  options: OptionsDossierClos = {},
): Promise<{ id: string; missionId: string }> {
  const m = options.signee
    ? await creerMissionSignee(s.a, { intitule })
    : await creerMission(s.a, { intitule });
  for (const u of options.equipe ?? []) {
    attendre(
      201,
      await s.a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: u.utilisateurId }),
      "équipe",
    );
  }
  const id = (await ouvrirDossierRed(s, m.id)).id;
  if (options.ouvert) return { id, missionId: m.id };
  if (options.joursDepuisCloture !== undefined) {
    const jours = options.joursDepuisCloture;
    await proprietaire((c) =>
      c.query(
        `UPDATE red_dossiers SET statut = 'clos', clos_le = now() - make_interval(days => $2),
           clos_par = $3, motif_cloture = 'Clôture de test' WHERE id = $1`,
        [id, jours, s.a.chef.utilisateurId],
      ),
    );
  } else {
    attendre(
      200,
      await s.a.directeur.post(`/api/redressement/dossiers/${id}/statut`, {
        statut: "clos",
        motif: "Objectifs atteints",
      }),
      "clôture",
    );
  }
  return { id, missionId: m.id };
}

/** Clôture la mission (propriétaire), après la clôture du dossier. */
export async function cloturerMission(missionId: string): Promise<void> {
  await proprietaire((c) =>
    c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [
      missionId,
    ]),
  );
}

export const releveSaisi = (extra: Record<string, unknown> = {}) => ({
  date_releve: aujourdhui(),
  source: "saisie",
  ratios: { endettement: 13_333 },
  ...extra,
});

/** SQLSTATE d'un refus de la base (rôle applicatif, RLS du cabinet) ; « aucun » si accepté. */
export async function codeSql(
  ctx: Contexte,
  cabinetId: string,
  fn: (db: Db) => Promise<unknown>,
): Promise<string> {
  try {
    await ctx.db.withTenant(cabinetId, fn);
  } catch (e) {
    return (e as { code?: string }).code ?? "inconnu";
  }
  return "aucun";
}

/** SQLSTATE d'un refus de la base pour le rôle propriétaire. */
export async function codeSqlProprietaire(sql: string, params: unknown[] = []): Promise<string> {
  return proprietaire(async (c) => {
    try {
      await c.query(sql, params);
      return "aucun";
    } catch (e) {
      return (e as { code?: string }).code ?? "inconnu";
    }
  });
}

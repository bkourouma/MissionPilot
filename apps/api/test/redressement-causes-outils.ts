import { proprietaire, type Contexte } from "./helpers.js";
import { demarrerIa, serveurFactice, type ServeurFactice } from "./ia-outils.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import { ouvrirDossierRed, preparerRed, type ScenarioRed } from "./redressement-outils.js";

/*
 * Outils des tests des causes racines proposées par l'IA (RED-04) : un serveur de modèle SIMULÉ
 * sur la machine locale (aucun appel réseau externe, aucune clé réelle), l'application de test
 * pointée vers lui, deux cabinets et des dossiers de redressement avec ou sans diagnostic.
 */

export interface ScenarioCauses {
  ctx: Contexte;
  serveur: ServeurFactice;
  s: ScenarioRed;
  /** Dossier du cabinet A avec une évaluation d'urgence (trésorerie 63 %, rouge). */
  dossierId: string;
}

export async function preparerCauses(): Promise<ScenarioCauses> {
  const serveur = await serveurFactice();
  const ctx = await demarrerIa(serveur.url);
  const s = await preparerRed(ctx, "RED causes");
  const dossierId = (await ouvrirDossierRed(s)).id;
  await saisirUrgence(s, dossierId);
  return { ctx, serveur, s, dossierId };
}

/** Évaluation d'urgence U2 : T1 oui, T2 partiellement, T3 non (trésorerie 63 %, rouge). */
export async function saisirUrgence(s: ScenarioRed, dossierId: string): Promise<void> {
  attendre(
    201,
    await s.a.chef.post(`/api/redressement/dossiers/${dossierId}/urgences`, {
      reponses: { T1: "oui", T2: "partiellement", T3: "non" },
    }),
    "urgence",
  );
}

let compteur = 0;

/** Nouvelle mission et nouveau dossier de redressement du cabinet A (avec ou sans urgence). */
export async function nouveauDossier(s: ScenarioRed, avecUrgence: boolean): Promise<string> {
  compteur += 1;
  const mission = await creerMission(s.a, { intitule: `Redressement causes ${compteur}` });
  const id = (await ouvrirDossierRed(s, mission.id)).id;
  if (avecUrgence) await saisirUrgence(s, id);
  return id;
}

/** Active l'IA du cabinet A (désactivée par défaut). */
export async function activerIa(s: ScenarioRed): Promise<void> {
  attendre(200, await s.a.associe.put("/api/ia/parametres", { ia_activee: true }), "IA activée");
}

/** Réponse du modèle simulé : le contenu d'un objet JSON. */
export const modele = (corps: unknown) => ({ contenu: JSON.stringify(corps) });

export const LIGNES_MODELE = [
  "tresorerie | Encaissements tardifs | Les clients paient avec retard : le voyant d'urgence est à 63 %. À vérifier sur la balance âgée. | moyen",
  "activite | Perte de clientèle | Hypothèse : un client important a réduit ses commandes. | faible",
  "exploitation | Stocks élevés | La rotation des stocks est à contrôler avec le responsable d'exploitation. |",
];

export const REPONSE_MODELE = { causes: LIGNES_MODELE };

export interface AuditCauses {
  action: string;
  entite: string;
  details: unknown;
}

/** Lignes du journal d'audit de la cartographie (hors contenu), par la connexion propriétaire. */
export async function auditDe(entiteId: string): Promise<AuditCauses[]> {
  return proprietaire(
    async (c) =>
      (
        await c.query(
          "SELECT action, entite, details FROM journal_audit WHERE entite_id = $1 ORDER BY cree_le",
          [entiteId],
        )
      ).rows as AuditCauses[],
  );
}

/**
 * Exécute des requêtes SQL par la connexion propriétaire dans une transaction annulée à la fin,
 * et rend le SQLSTATE du premier refus (« aucun » si tout est accepté).
 */
export async function refusSql(
  corps: (q: (sql: string, p?: unknown[]) => Promise<unknown>) => Promise<void>,
): Promise<string> {
  return proprietaire(async (c) => {
    await c.query("BEGIN");
    try {
      await corps((sql, p) => c.query(sql, p));
      return "aucun";
    } catch (e) {
      return (e as { code?: string }).code ?? "inconnu";
    } finally {
      await c.query("ROLLBACK");
    }
  });
}

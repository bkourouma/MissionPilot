import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import { proprietaire } from "./helpers.js";
import { demarrerIa, serveurFactice, type ServeurFactice } from "./ia-outils.js";
import { creerMission, creerMissionSignee } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  COVENANTS_CAS_A,
  DEBUT,
  ligneTreso,
  LIGNES_TRESO,
  M,
  versionTreso,
} from "./redressement-financement-outils.js";
import {
  CORRESPONDANCE_CAS_A,
  ouvrirDossierRed,
  preparerCasA,
  preparerRed,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Outils des tests du bilan de clôture et du rapport de clôture (RED-08, lot 2) : un serveur de
 * modèle SIMULÉ local (aucun appel réseau externe, aucune clé réelle) pour les causes racines, deux
 * cabinets et des dossiers de redressement RENSEIGNÉS par l'API (urgences, scores, trésorerie, plan
 * validé, créanciers, covenants, check-list, causes validées) ou laissés incomplets.
 */

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ScenarioCloture {
  ctx: Contexte;
  serveur: ServeurFactice;
  s: ScenarioRed;
  /** Dossier du cabinet A, entièrement renseigné (états 2024 et 2025 acceptés, cas A). */
  dossierId: string;
  /** Ferme l'application, le serveur de modèle simulé et le stockage temporaire. */
  fermer: () => Promise<void>;
}

/** Date civile (UTC) à `n` jours d'aujourd'hui : les fenêtres du plan dépendent du jour courant. */
export const dans = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export const urlD = (dossierId: string, suffixe = ""): string =>
  `/api/redressement/dossiers/${dossierId}${suffixe}`;
export const urlCloturesD = (dossierId: string, suffixe = ""): string =>
  urlD(dossierId, `/clotures${suffixe}`);
export const urlC = (id: string, suffixe = ""): string =>
  `/api/redressement/clotures/${id}${suffixe}`;

export async function preparerCloture(): Promise<ScenarioCloture> {
  const serveur = await serveurFactice();
  const stockage = await mkdtemp(path.join(os.tmpdir(), "missionpilot-red-cloture-"));
  const ctx = await demarrerIa(serveur.url, { STORAGE_DIR: stockage });
  const s = await preparerRed(ctx, "RED clôture");
  const { dossierId } = await preparerCasA(s);
  await renseigner(s, dossierId);
  return {
    ctx,
    serveur,
    s,
    dossierId,
    fermer: async () => {
      await ctx.fermer();
      await serveur.fermer();
      await rm(stockage, { recursive: true, force: true });
    },
  };
}

/** Nouvelle mission (signée ou non) et nouveau dossier du cabinet A, correspondance du cas A posée. */
export async function nouveauDossierCas(
  s: ScenarioRed,
  intitule: string,
  signee = false,
  extra: Record<string, unknown> = {},
): Promise<{ dossierId: string; missionId: string }> {
  const mission = signee
    ? await creerMissionSignee(s.a, { intitule, ...extra })
    : await creerMission(s.a, { intitule, ...extra });
  const dossier = await ouvrirDossierRed(s, mission.id);
  attendre(
    201,
    await s.a.associe.post(urlD(dossier.id, "/correspondances"), {
      postes: CORRESPONDANCE_CAS_A,
    }),
    "correspondance",
  );
  return { dossierId: dossier.id, missionId: mission.id };
}

/** Évaluations d'urgence : la première charge tous les domaines évalués, la seconde les allège. */
export async function saisirUrgences(s: ScenarioRed, dossierId: string): Promise<void> {
  for (const reponses of [
    { T1: "oui", T2: "oui", T3: "oui" },
    { T1: "non", T2: "partiellement", T3: "non" },
  ]) {
    attendre(201, await s.a.chef.post(urlD(dossierId, "/urgences"), { reponses }), "urgence");
  }
}

/** Scores d'alerte : le premier avec des incidents de paiement, le second sans. */
export async function saisirScores(s: ScenarioRed, dossierId: string): Promise<void> {
  const incidents = (rejets: number, retards: number, arrieres: boolean) => ({
    incidents: {
      rejets_bancaires_12m: rejets,
      retards_fournisseurs_90j: retards,
      arrieres_fiscaux_sociaux: arrieres,
    },
  });
  for (const corps of [incidents(5, 12, true), incidents(0, 0, false)]) {
    attendre(201, await s.a.chef.post(urlD(dossierId, "/scores"), corps), "score");
  }
}

/** Deux versions de prévision de trésorerie : la seconde ajoute un encaissement important. */
export async function saisirTresorerie(s: ScenarioRed, dossierId: string): Promise<void> {
  attendre(201, await s.a.chef.post(urlD(dossierId, "/tresorerie/versions"), versionTreso()), "v1");
  attendre(
    201,
    await s.a.chef.post(
      urlD(dossierId, "/tresorerie/versions"),
      versionTreso({
        lignes: [...LIGNES_TRESO, ligneTreso(5, "encaissement", "clients", 200 * M)],
        motif: "Révision après accord",
      }),
    ),
    "v2",
  );
  attendre(
    201,
    await s.a.chef.post(urlD(dossierId, "/tresorerie/realises"), {
      semaine_debut: DEBUT,
      flux: { encaissement: { clients: 28 * M }, decaissement: { fournisseurs: 41 * M } },
    }),
    "réalisé",
  );
}

const action = (s: ScenarioRed, extra: Record<string, unknown>) => ({
  titre: "Relancer les clients en retard",
  volet: "quick_win",
  domaine: "tresorerie",
  echeance: dans(30),
  responsable_id: s.a.directeur.utilisateurId,
  ...extra,
});

/**
 * Plan : trois actions (deux avec levier), version de plan créée par le chef puis validée par le
 * directeur ; ensuite, un gain rapide avec levier est terminé.
 */
export async function saisirPlan(
  s: ScenarioRed,
  dossierId: string,
  validateur: Api = s.a.directeur,
): Promise<void> {
  const creer = async (extra: Record<string, unknown>): Promise<Json> => {
    const r = await s.a.chef.post(urlD(dossierId, "/actions"), action(s, extra));
    attendre(201, r, "action");
    return r.json();
  };
  const levier = await creer({
    titre: "Réduire le délai clients",
    levier: { code: "reduction_delai_clients", parametres: { joursGagnes: 10 } },
  });
  await creer({ titre: "Négocier avec les fournisseurs" });
  await creer({
    titre: "Réduire les charges fixes",
    volet: "restructuration",
    domaine: "exploitation",
    echeance: dans(300),
    levier: {
      code: "reduction_charges_fixes",
      parametres: { chargesFixesAnnuelles: 300 * M, reductionPb: 1000, moisMiseEnOeuvre: 3 },
    },
  });
  const version = await s.a.chef.post(urlD(dossierId, "/plan/versions"), {});
  attendre(201, version, "version de plan");
  attendre(
    200,
    await validateur.post(`/api/redressement/plan/versions/${version.json().id}/validation`, {}),
    "validation du plan",
  );
  attendre(
    200,
    await s.a.chef.post(`/api/redressement/actions/${levier.id}/deplacement`, {
      statut: "terminee",
      termine_le: dans(-1),
    }),
    "action terminée",
  );
}

/** Deux créanciers : l'un avec un accord régulier, l'autre sans. */
export async function saisirCreanciers(s: ScenarioRed, dossierId: string): Promise<void> {
  const creer = async (extra: Record<string, unknown>): Promise<Json> => {
    const r = await s.a.chef.post(urlD(dossierId, "/creanciers"), {
      nom: "Banque de développement",
      categorie: "banque",
      principal: 90 * M,
      interets: 10 * M,
      date_arrete: "2026-10-01",
      ...extra,
    });
    attendre(201, r, "créancier");
    return r.json();
  };
  const avecAccord = await creer({});
  await creer({ nom: "Fournisseur sans accord", categorie: "fournisseur", principal: 20 * M });
  attendre(
    201,
    await s.a.chef.post(`/api/redressement/creanciers/${avecAccord.id}/evenements`, {
      type: "accord",
      date_evenement: "2026-10-10",
      montant: 60 * M,
      conditions: "Remise partielle",
      echeancier: {
        mode: "regulier",
        nombre_echeances: 3,
        date_premiere: "2027-11-30",
        periodicite_mois: 1,
      },
    }),
    "accord",
  );
}

/** Covenants du cas A (associé), puis check-list de départ « industrie » (chef). */
export async function saisirConformite(s: ScenarioRed, dossierId: string): Promise<void> {
  attendre(
    201,
    await s.a.associe.post(urlD(dossierId, "/covenants/versions"), {
      covenants: COVENANTS_CAS_A,
      motif: "Contrat de prêt",
    }),
    "covenants",
  );
  attendre(
    201,
    await s.a.chef.post(urlD(dossierId, "/checklists"), {
      origine: "depart",
      code: "depart_industrie",
    }),
    "check-list",
  );
}

/** Cartographie des causes : repli déterministe proposé par le chef, validé par un associé. */
export async function validerCauses(s: ScenarioRed, dossierId: string): Promise<string> {
  const g = await s.a.chef.post(urlD(dossierId, "/causes/generation"), {});
  attendre(201, g, "causes");
  const id = g.json().id as string;
  attendre(
    200,
    await s.a.associe.post(`/api/redressement/causes/${id}/validation`, {}),
    "causes validées",
  );
  return id;
}

/** Renseigne tout ce que le bilan lit (causes validées en dernier : elles lisent le diagnostic). */
export async function renseigner(
  s: ScenarioRed,
  dossierId: string,
  options: { causes?: boolean; directeur?: Api } = {},
): Promise<void> {
  await saisirUrgences(s, dossierId);
  await saisirScores(s, dossierId);
  await saisirTresorerie(s, dossierId);
  await saisirPlan(s, dossierId, options.directeur);
  await saisirCreanciers(s, dossierId);
  await saisirConformite(s, dossierId);
  if (options.causes ?? true) await validerCauses(s, dossierId);
}

/** Dossier neuf entièrement renseigné (mission signée si demandé, pour pouvoir la clôturer). */
export async function dossierComplet(
  s: ScenarioRed,
  intitule: string,
  options: {
    signee?: boolean;
    causes?: boolean;
    mission?: Record<string, unknown>;
    directeur?: Api;
  } = {},
): Promise<{ dossierId: string; missionId: string }> {
  const d = await nouveauDossierCas(s, intitule, options.signee ?? false, options.mission);
  await renseigner(s, d.dossierId, options);
  return d;
}

/** Construit un brouillon de bilan par le chef et le rend. */
export async function construireBilan(par: Api, dossierId: string): Promise<Json> {
  const r = await par.post(urlCloturesD(dossierId), {});
  attendre(201, r, "bilan de clôture");
  return r.json();
}

/** Clôture la mission (propriétaire) : exige une mission signée. */
export async function cloturerMission(missionId: string): Promise<void> {
  await proprietaire((c) =>
    c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [
      missionId,
    ]),
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

/** Lignes du journal d'audit d'une entité, par la connexion propriétaire. */
export async function auditDe(
  entiteId: string,
): Promise<{ action: string; entite: string; details: unknown }[]> {
  return proprietaire(
    async (c) =>
      (
        await c.query(
          "SELECT action, entite, details FROM journal_audit WHERE entite_id = $1 ORDER BY cree_le",
          [entiteId],
        )
      ).rows,
  );
}

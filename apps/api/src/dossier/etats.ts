import { controlerEtatFinancier, type ControleEtatFinancier } from "@missionpilot/engines";
import {
  ETATS_PAR_CLIENT_MAX,
  type EtatDecision,
  type LigneEtatFinancierSaisie,
  type StatutEtatDossier,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { verrouillerDossier } from "./acces.js";
import { inscrireFiabilite } from "./fiabilite.js";

/*
 * États financiers du client (DOS-03). Ingestion : lignes (saisie, CSV ou Excel, chacune
 * avec sa référence) → contrôles du moteur `controlerEtatFinancier` → acceptation
 * AUTOMATIQUE seulement si tous les contrôles passent (conforme et complet) À TOLÉRANCE NULLE
 * et si l'état ne remplace pas un état déjà accepté par un humain ; sinon file de revue avec
 * les écarts. La tolérance est choisie par l'importateur : elle ne décide jamais seule d'une
 * acceptation (tolérance > 0 : revue obligatoire, motif et autre décideur, comme un écart).
 * Jamais d'acceptation silencieuse : doublé en base (MPO04, 0222 puis 0224).
 * Un nouvel état du même exercice remplace l'état courant (historique conservé). Revue :
 * accepter un état en écart exige un motif et un autre décideur que l'importateur (sauf
 * associé) ; le rejet est toujours motivé.
 *
 * Un chiffre EXTRAIT d'un document client est une donnée sourcée, pas un chiffre produit
 * par l'IA (DECISIONS.md) : il ne sert aux calculs qu'une fois l'état accepté.
 */

export interface EnTeteEtat {
  exercice: number;
  date_cloture: string;
  devise: string;
  tolerance: number;
  source_libelle?: string | null;
}

export interface FichierAnalyse {
  nom: string | null;
  sha256: string;
  taille: number;
}

const COLONNES_ETAT = `e.id, e.client_id, e.exercice, e.date_cloture::text AS date_cloture, e.devise,
  e.origine, e.source_libelle, e.fichier_nom, e.fichier_sha256, e.fichier_taille, e.tolerance::int AS tolerance,
  e.controles, e.totaux, e.conforme, e.complet, e.controles_ok, e.remplace_id, e.importe_par,
  ui.nom AS importe_par_nom, e.cree_le, d.decision, d.automatique, d.motif AS decision_motif,
  d.decideur_id, ud.nom AS decideur_nom, d.cree_le AS decide_le, r.id AS remplace_par_id`;

const JOINTURES_ETAT = `FROM dossier_etats_financiers e
  JOIN utilisateurs ui ON ui.id = e.importe_par
  LEFT JOIN dossier_etats_decisions d ON d.etat_id = e.id
  LEFT JOIN utilisateurs ud ON ud.id = d.decideur_id
  LEFT JOIN dossier_etats_financiers r ON r.remplace_id = e.id`;

export function statutEtat(e: Record<string, unknown>): StatutEtatDossier {
  if (e.remplace_par_id) return "remplace";
  if (e.decision === "rejete") return "rejete";
  return e.decision === "accepte" ? "accepte" : "en_revue";
}

const horodatage = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));

/** Projection d'un état (sans ses lignes). */
export function vueEtat(e: Record<string, unknown>) {
  const constats = (e.controles as { statut: string }[]) ?? [];
  return {
    id: e.id as string,
    client_id: e.client_id as string,
    exercice: e.exercice as number,
    date_cloture: e.date_cloture as string,
    devise: e.devise as string,
    origine: e.origine as string,
    source_libelle: e.source_libelle ?? null,
    fichier: e.fichier_sha256
      ? { nom: e.fichier_nom ?? null, sha256: e.fichier_sha256, taille: e.fichier_taille }
      : null,
    tolerance: e.tolerance as number,
    statut: statutEtat(e),
    controles_ok: e.controles_ok as boolean,
    conforme: e.conforme as boolean,
    complet: e.complet as boolean,
    ecarts: constats.filter((c) => c.statut === "ecart").length,
    non_verifiables: constats.filter((c) => c.statut === "non_verifiable").length,
    constats,
    totaux: e.totaux,
    remplace_id: e.remplace_id ?? null,
    remplace_par_id: e.remplace_par_id ?? null,
    importe_par: { id: e.importe_par, nom: e.importe_par_nom },
    cree_le: horodatage(e.cree_le),
    decision: e.decision
      ? {
          decision: e.decision,
          automatique: e.automatique,
          motif: e.decision_motif ?? null,
          par: e.decideur_id ? { id: e.decideur_id, nom: e.decideur_nom } : null,
          le: horodatage(e.decide_le),
        }
      : null,
  };
}
export type VueEtat = ReturnType<typeof vueEtat>;

/** Tous les états d'un client, historique compris (plafonnés). */
export async function listerEtats(db: Db, clientId: string): Promise<VueEtat[]> {
  const r = await db.query(
    `SELECT ${COLONNES_ETAT} ${JOINTURES_ETAT} WHERE e.client_id = $1
     ORDER BY e.exercice DESC, e.cree_le DESC, e.id LIMIT $2`,
    [clientId, ETATS_PAR_CLIENT_MAX],
  );
  return r.rows.map(vueEtat);
}

async function lireEtat(
  db: Db,
  clientId: string,
  etatId: string,
): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES_ETAT} ${JOINTURES_ETAT} WHERE e.id = $1 AND e.client_id = $2`,
    [etatId, clientId],
  );
  if (!r.rows[0]) throw introuvable("État financier");
  return r.rows[0];
}

/** État et ses lignes (dans l'ordre d'ingestion, chacune avec sa référence). */
export async function detailEtat(db: Db, clientId: string, etatId: string) {
  const etat = vueEtat(await lireEtat(db, clientId, etatId));
  const lignes = await db.query(
    `SELECT rang, code, libelle, section, montant, parent_code, role, reference
     FROM dossier_etats_lignes WHERE etat_id = $1 ORDER BY rang`,
    [etatId],
  );
  return {
    ...etat,
    lignes: lignes.rows.map((l) => ({
      rang: l.rang as number,
      code: l.code as string,
      libelle: l.libelle as string,
      section: l.section as string,
      montant: Number(l.montant),
      parent: l.parent_code ?? null,
      role: l.role ?? null,
      reference: l.reference,
    })),
  };
}

/** Contrôles du moteur (une structure invalide lève `ErreurDossier`, traduite en 400). */
export function controler(
  lignes: readonly LigneEtatFinancierSaisie[],
  tolerance: number,
): ControleEtatFinancier {
  return controlerEtatFinancier(
    lignes.map((l) => ({
      code: l.code,
      section: l.section,
      montant: l.montant,
      parent: l.parent ?? null,
      role: l.role ?? null,
    })),
    { tolerance },
  );
}

async function etatCourant(db: Db, clientId: string, exercice: number): Promise<string | null> {
  const r = await db.query(
    `SELECT e.id FROM dossier_etats_financiers e
     WHERE e.client_id = $1 AND e.exercice = $2
       AND NOT EXISTS (SELECT 1 FROM dossier_etats_financiers r WHERE r.remplace_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM dossier_etats_decisions d WHERE d.etat_id = e.id AND d.decision = 'rejete')`,
    [clientId, exercice],
  );
  return (r.rows[0]?.id as string | undefined) ?? null;
}

/** L'état a été accepté par une décision humaine (et non automatiquement). */
async function acceptationHumaine(db: Db, etatId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM dossier_etats_decisions WHERE etat_id = $1 AND decision = 'accepte' AND NOT automatique`,
    [etatId],
  );
  return r.rowCount === 1;
}

async function insererLignes(
  db: Db,
  cabinetId: string,
  etatId: string,
  lignes: readonly LigneEtatFinancierSaisie[],
) {
  await db.query(
    `INSERT INTO dossier_etats_lignes (cabinet_id, etat_id, rang, code, libelle, section, montant,
       parent_code, role, reference)
     SELECT $1, $2, x.rang, x.code, x.libelle, x.section, x.montant, x.parent, x.role, x.reference
     FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::text[], $9::text[], $10::jsonb[])
       AS x(rang, code, libelle, section, montant, parent, role, reference)`,
    [
      cabinetId,
      etatId,
      lignes.map((_, i) => i + 1),
      lignes.map((l) => l.code),
      lignes.map((l) => l.libelle),
      lignes.map((l) => l.section),
      lignes.map((l) => String(l.montant)),
      lignes.map((l) => l.parent ?? null),
      lignes.map((l) => l.role ?? null),
      lignes.map((l) => JSON.stringify(l.reference ?? {})),
    ],
  );
}

/**
 * Ingère un état : contrôles, inscription (remplace l'état courant de l'exercice), lignes,
 * acceptation automatique si et seulement si tous les contrôles passent. Dossier visible
 * (appelant). Renvoie le détail de l'état.
 */
export async function ingererEtat(
  db: Db,
  auth: Auth,
  clientId: string,
  entete: EnTeteEtat,
  lignes: readonly LigneEtatFinancierSaisie[],
  origine: "saisie" | "csv" | "excel",
  fichier: FichierAnalyse | null,
) {
  const controle = controler(lignes, entete.tolerance);
  if (
    entete.date_cloture.slice(0, 4) !== String(entete.exercice) &&
    entete.date_cloture.slice(0, 4) !== String(entete.exercice + 1)
  ) {
    throw requeteInvalide("La date de clôture doit tomber dans l'exercice (ou l'année suivante).");
  }
  await verrouillerDossier(db, clientId);
  const n = await db.query(
    "SELECT count(*)::int AS n FROM dossier_etats_financiers WHERE client_id = $1",
    [clientId],
  );
  if ((n.rows[0].n as number) >= ETATS_PAR_CLIENT_MAX) {
    throw new AppError(
      409,
      "DOSSIER_PLEIN",
      `Au plus ${ETATS_PAR_CLIENT_MAX} états financiers par dossier.`,
    );
  }
  const remplace = await etatCourant(db, clientId, entete.exercice);
  const automatique =
    controle.acceptationAutomatique &&
    entete.tolerance === 0 &&
    !(remplace && (await acceptationHumaine(db, remplace)));
  const r = await db.query(
    `INSERT INTO dossier_etats_financiers (cabinet_id, client_id, exercice, date_cloture, devise, origine,
       source_libelle, fichier_nom, fichier_sha256, fichier_taille, tolerance, controles, totaux,
       conforme, complet, controles_ok, remplace_id, importe_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING id`,
    [
      auth.cabinetId,
      clientId,
      entete.exercice,
      entete.date_cloture,
      entete.devise,
      origine,
      entete.source_libelle ?? null,
      fichier?.nom ?? null,
      fichier?.sha256 ?? null,
      fichier?.taille ?? null,
      entete.tolerance,
      JSON.stringify(controle.constats),
      JSON.stringify(controle.totaux),
      controle.conforme,
      controle.complet,
      controle.acceptationAutomatique,
      remplace,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await insererLignes(db, auth.cabinetId, id, lignes);
  if (automatique) {
    await db.query(
      `INSERT INTO dossier_etats_decisions (cabinet_id, etat_id, decision, automatique)
       VALUES ($1, $2, 'accepte', true)`,
      [auth.cabinetId, id],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "import",
    entite: "dossier_etat_financier",
    entiteId: id,
    details: {
      client_id: clientId,
      exercice: entete.exercice,
      origine,
      lignes: lignes.length,
      accepte_automatiquement: automatique,
      tolerance: entete.tolerance,
      remplace_id: remplace,
      fichier_sha256: fichier?.sha256 ?? null,
    },
  });
  await inscrireFiabilite(db, auth, clientId);
  return detailEtat(db, clientId, id);
}

/** Accepte (motif obligatoire si des contrôles échouent) ou rejette (motif) un état en revue. */
export async function deciderEtat(
  db: Db,
  auth: Auth,
  clientId: string,
  etatId: string,
  d: EtatDecision,
) {
  await verrouillerDossier(db, clientId);
  const etat = await lireEtat(db, clientId, etatId);
  if (statutEtat(etat) !== "en_revue") throw conflit("Seul un état en revue reçoit une décision.");
  // Acceptation « sous réserve » : contrôles en échec, tolérance non nulle ou état qui remplace un
  // état accepté par un humain. Motif obligatoire et décideur autre que l'importateur (sauf associé).
  const force =
    d.decision === "accepte" &&
    (!etat.controles_ok ||
      Number(etat.tolerance) > 0 ||
      (typeof etat.remplace_id === "string" && (await acceptationHumaine(db, etat.remplace_id))));
  if (force && !d.motif) {
    throw requeteInvalide(
      "Motif obligatoire pour accepter un état dont des contrôles échouent, de tolérance non nulle ou qui remplace un état accepté.",
    );
  }
  if (force && etat.importe_par === auth.utilisateurId && !estAssocie(auth)) {
    throw new AppError(
      403,
      "VALIDATION_REQUISE",
      "L'importateur n'accepte pas lui-même un état en écart, de tolérance non nulle ou qui en remplace un accepté : le faire accepter par un autre membre.",
    );
  }
  await db.query(
    `INSERT INTO dossier_etats_decisions (cabinet_id, etat_id, decision, automatique, motif, decideur_id)
     VALUES ($1, $2, $3, false, $4, $5)`,
    [auth.cabinetId, etatId, d.decision, d.motif ?? null, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: d.decision === "accepte" ? "acceptation" : "rejet",
    entite: "dossier_etat_financier",
    entiteId: etatId,
    details: { client_id: clientId, exercice: etat.exercice, malgre_ecarts: force },
  });
  await inscrireFiabilite(db, auth, clientId);
  return detailEtat(db, clientId, etatId);
}

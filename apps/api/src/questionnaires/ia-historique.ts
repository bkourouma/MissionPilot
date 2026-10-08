import type { StatutContenu } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { suspectsRestants } from "../ia/garde-chiffres.js";
import { estAssocie } from "../missions/acces.js";

/*
 * Historique de contenu d'une version de questionnaire d'ORIGINE IA (SOC-11,
 * migration 0149) : « brouillon_ia » (proposition), « modifie » (retouche d'un
 * consultant), « valide ». Ajout seul, tenu par déclencheurs (MPQ06, MPQ08).
 *
 * Règles du circuit humain, comme pour les autres contenus IA
 * (ia/generations.ts) :
 * - l'IA propose, le consultant dispose : seule une version « valide » peut
 *   s'envoyer à un client (0141) ; la validation d'une version d'origine IA
 *   passe par `validerContenuIa`, que la base exige (MPQ08) ;
 * - séparation des tâches : le valideur n'est ni le demandeur ni l'auteur
 *   d'un rang de l'historique, sauf associé ;
 * - des nombres non issus d'un moteur de calcul (garde-chiffres) exigent un
 *   acquittement explicite.
 * Une version sans historique (modèle rédigé à la main, gabarit, copie) n'est
 * pas concernée : ces fonctions ne font rien.
 */

export interface RangHistoriqueIa {
  rang: number;
  statut_contenu: StatutContenu;
  auteur: { id: string; nom: string };
  chiffres_non_verifies: boolean;
  cree_le: string;
}

export interface OrigineIa {
  /** Statut du contenu = celui du dernier rang. */
  statut_contenu: StatutContenu;
  demande_id: string;
  brief: Record<string, unknown>;
  /** Contenu fabriqué par le gabarit déterministe (IA indisponible ou sortie inexploitable). */
  gabarit: boolean;
  chiffres_non_verifies: boolean;
  nombres_non_verifies: string[];
  chiffres_acquittes: boolean;
  historique: RangHistoriqueIa[];
}

interface LigneHistorique {
  rang: number;
  statut_contenu: StatutContenu;
  auteur_id: string;
  auteur_nom: string;
  demande_id: string | null;
  brief: Record<string, unknown> | null;
  gabarit: boolean;
  chiffres_non_verifies: boolean;
  nombres_non_verifies: string[];
  chiffres_acquittes: boolean;
  cree_le: string;
}

async function lignes(db: Db, versionId: string): Promise<LigneHistorique[]> {
  const r = await db.query(
    `SELECT h.rang, h.statut_contenu, h.auteur_id, u.nom AS auteur_nom, h.demande_id, h.brief,
       h.gabarit, h.chiffres_non_verifies, h.nombres_non_verifies, h.chiffres_acquittes, h.cree_le
     FROM questionnaire_ia_historique h JOIN utilisateurs u ON u.id = h.auteur_id
     WHERE h.version_id = $1 ORDER BY h.rang`,
    [versionId],
  );
  return r.rows as LigneHistorique[];
}

/** Origine IA d'une version et son historique, ou null si la version n'en a pas. */
export async function lireOrigineIa(db: Db, versionId: string): Promise<OrigineIa | null> {
  const l = await lignes(db, versionId);
  const premier = l[0];
  const dernier = l[l.length - 1];
  if (!premier || !dernier) return null;
  return {
    statut_contenu: dernier.statut_contenu,
    demande_id: premier.demande_id as string,
    brief: premier.brief ?? {},
    gabarit: premier.gabarit,
    chiffres_non_verifies: dernier.chiffres_non_verifies,
    nombres_non_verifies: dernier.nombres_non_verifies,
    chiffres_acquittes: dernier.chiffres_acquittes,
    historique: l.map((x) => ({
      rang: x.rang,
      statut_contenu: x.statut_contenu,
      auteur: { id: x.auteur_id, nom: x.auteur_nom },
      chiffres_non_verifies: x.chiffres_non_verifies,
      cree_le: x.cree_le,
    })),
  };
}

/** Premier rang : la proposition de l'IA (version 1 du modèle, dans la transaction de création). */
export async function inscrireBrouillonIa(
  db: Db,
  auth: Auth,
  versionId: string,
  p: {
    demandeId: string;
    brief: Record<string, unknown>;
    gabarit: boolean;
    chiffresNonVerifies: boolean;
    nombresNonVerifies: readonly string[];
  },
): Promise<void> {
  await db.query(
    `INSERT INTO questionnaire_ia_historique (cabinet_id, version_id, rang, statut_contenu, auteur_id,
       demande_id, brief, gabarit, chiffres_non_verifies, nombres_non_verifies)
     VALUES ($1, $2, 1, 'brouillon_ia', $3, $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      versionId,
      auth.utilisateurId,
      p.demandeId,
      JSON.stringify(p.brief),
      p.gabarit,
      p.chiffresNonVerifies,
      JSON.stringify(p.nombresNonVerifies),
    ],
  );
}

/**
 * Retouche d'une version d'origine IA : nouveau rang « modifie » AVANT
 * l'écriture de la définition (le déclencheur l'exige dans la même
 * transaction). Les nombres venus du modèle qui ne figurent plus dans la
 * définition n'ont plus à être acquittés.
 */
export async function inscrireModificationIa(
  db: Db,
  auth: Auth,
  versionId: string,
  definition: unknown,
): Promise<void> {
  const l = await lignes(db, versionId);
  const dernier = l[l.length - 1];
  if (!dernier) return;
  const restants = suspectsRestants(JSON.stringify(definition), dernier.nombres_non_verifies);
  await db.query(
    `INSERT INTO questionnaire_ia_historique (cabinet_id, version_id, rang, statut_contenu, auteur_id,
       gabarit, chiffres_non_verifies, nombres_non_verifies)
     VALUES ($1, $2, $3, 'modifie', $4, $5, $6, $7)`,
    [
      auth.cabinetId,
      versionId,
      dernier.rang + 1,
      auth.utilisateurId,
      l[0]?.gabarit ?? false,
      restants.length > 0,
      JSON.stringify(restants),
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification_contenu_ia",
    entite: "questionnaire_version",
    entiteId: versionId,
    details: { rang: dernier.rang + 1, chiffres_non_verifies: restants.length > 0 },
  });
}

/**
 * Validation d'une version d'origine IA (avant le passage de la version à
 * « valide ») : séparation des tâches et acquittement des nombres, puis rang
 * « valide ». Sans effet pour une version sans historique IA.
 */
export async function validerContenuIa(
  db: Db,
  auth: Auth,
  versionId: string,
  acquitteChiffres: boolean,
): Promise<void> {
  const l = await lignes(db, versionId);
  const dernier = l[l.length - 1];
  if (!dernier) return;
  if (!estAssocie(auth) && l.some((x) => x.auteur_id === auth.utilisateurId)) {
    throw new AppError(
      403,
      "APPROBATION_REQUISE",
      "Le demandeur ou l'auteur d'une version d'un contenu proposé par l'IA ne le valide pas lui-même.",
    );
  }
  if (dernier.chiffres_non_verifies && !acquitteChiffres) {
    throw new AppError(
      409,
      "CHIFFRES_NON_VERIFIES",
      "Des nombres du questionnaire ne viennent pas des moteurs de calcul : vérifiez-les puis acquittez-les explicitement.",
    );
  }
  await db.query(
    `INSERT INTO questionnaire_ia_historique (cabinet_id, version_id, rang, statut_contenu, auteur_id,
       gabarit, chiffres_non_verifies, nombres_non_verifies, chiffres_acquittes)
     VALUES ($1, $2, $3, 'valide', $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      versionId,
      dernier.rang + 1,
      auth.utilisateurId,
      l[0]?.gabarit ?? false,
      dernier.chiffres_non_verifies,
      JSON.stringify(dernier.nombres_non_verifies),
      dernier.chiffres_non_verifies && acquitteChiffres,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "validation_contenu_ia",
    entite: "questionnaire_version",
    entiteId: versionId,
    details: {
      rang: dernier.rang + 1,
      acquitte_chiffres: dernier.chiffres_non_verifies && acquitteChiffres,
    },
  });
}

/**
 * Documents de mission (SOC-05) et statut des contenus (SOC-06) : versions, statut brouillon IA /
 * modifié / validé, droits d'action et saisie d'un dépôt. Logique pure, testée dans
 * `documents.test.ts`. Les règles reproduisent `routes/documents.ts` ; l'API reste seule juge
 * (elle répond 403 APPROBATION_REQUISE ou 409 si une action n'est pas permise).
 */
import {
  aPermission,
  TYPES_DOCUMENT,
  type Role,
  type StatutContenu,
  type TypeDocument,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { NomIcone } from "../components/ui/Icone";
import { ErreurApi } from "./api";
import { messageTeleversement, type FichierMeta } from "./fichiers";
import type { Resultat } from "./saisie";

export interface VersionDocument {
  id: string;
  mission_id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  auteur_id: string | null;
  auteur_nom: string | null;
  chemin_stockage: string | null;
  cree_le: string;
  fichier_id: string | null;
  fichier: FichierMeta | null;
  statut_contenu: StatutContenu | null;
  contenu_modifie_par: string | null;
  valide_par: string | null;
  valide_le: string | null;
  version_courante: number;
  est_version_courante: boolean;
}

export interface EtapeStatut {
  statut: StatutContenu;
  par: string | null;
  par_nom: string | null;
  cree_le: string;
}

export interface DetailDocument extends VersionDocument {
  versions: VersionDocument[];
  historique_statut: EtapeStatut[];
}

export const STATUT_CONTENU: Record<
  StatutContenu,
  { libelle: string; tonalite: TonaliteStatut; icone: NomIcone; aide: string }
> = {
  brouillon_ia: {
    libelle: "Brouillon IA",
    tonalite: "attention",
    icone: "attention",
    aide: "Contenu généré, à relire par un consultant avant tout envoi au client.",
  },
  modifie: {
    libelle: "Modifié",
    tonalite: "neutre",
    icone: "crayon",
    aide: "Relu et corrigé, en attente de validation par un responsable de la mission.",
  },
  valide: {
    libelle: "Validé",
    tonalite: "succes",
    icone: "succes",
    aide: "Validé : contenu définitif.",
  },
};

// --- Droits ----------------------------------------------------------------------------------

export interface ContexteDocuments {
  roles: readonly Role[];
  utilisateurId: string;
  chefId: string | null;
  directeurId: string | null;
  missionCloturee: boolean;
}

const estAssocie = (roles: readonly Role[]) => roles.includes("associe");

/** Responsable de la mission : toutes les missions, ou chef / directeur de celle-ci. */
export function responsableMission(c: ContexteDocuments): boolean {
  return (
    aPermission(c.roles, "mission.modifier_toutes") ||
    (c.chefId !== null && c.chefId === c.utilisateurId) ||
    (c.directeurId !== null && c.directeurId === c.utilisateurId)
  );
}

/** Proposition et lettre de mission : responsables (et « mission.signer » pour la lettre). */
export function peutEcrireType(type: TypeDocument, c: ContexteDocuments): boolean {
  if (!aPermission(c.roles, "document.ecrire") || c.missionCloturee) return false;
  if (type !== "proposition" && type !== "lettre_de_mission") return true;
  if (!responsableMission(c)) return false;
  return type !== "lettre_de_mission" || aPermission(c.roles, "mission.signer");
}

/** Types que l'utilisateur peut déposer sur cette mission. */
export const typesDeposables = (c: ContexteDocuments): TypeDocument[] =>
  TYPES_DOCUMENT.filter((t) => peutEcrireType(t, c));

export interface ActionsDocument {
  nouvelleVersion: boolean;
  marquerModifie: boolean;
  valider: boolean;
  /** Pourquoi « Valider » n'est pas proposé à quelqu'un qui pourrait écrire (texte d'aide). */
  raisonSansValidation: string | null;
}

export function actionsDocument(
  d: Pick<
    VersionDocument,
    "type" | "statut_contenu" | "est_version_courante" | "auteur_id" | "contenu_modifie_par"
  >,
  c: ContexteDocuments,
): ActionsDocument {
  const ecrire = peutEcrireType(d.type, c);
  const enCircuit =
    ecrire && d.est_version_courante && d.statut_contenu !== null && d.statut_contenu !== "valide";
  let valider = false;
  let raison: string | null = null;
  if (enCircuit) {
    const auteur = d.auteur_id === c.utilisateurId || d.contenu_modifie_par === c.utilisateurId;
    if (!responsableMission(c))
      raison = "La validation revient au chef ou au directeur de la mission, ou à un associé.";
    else if (auteur && !estAssocie(c.roles))
      raison = "Vous avez déposé ou modifié ce contenu : un autre responsable doit le valider.";
    else valider = true;
  }
  return {
    nouvelleVersion: ecrire && d.est_version_courante,
    marquerModifie: enCircuit && d.statut_contenu === "brouillon_ia",
    valider,
    raisonSansValidation: raison,
  };
}

/** Message propre aux documents : validation refusée, version non courante, contenu identique. */
export function messageDocument(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "APPROBATION_REQUISE")
      return `Validation refusée : ${e.message} Demandez à un autre responsable de la mission de valider.`;
    if (e.code === "STATUT_CONTENU") return e.message;
  }
  return messageTeleversement(e);
}

// --- Présentation ---------------------------------------------------------------------------

/** Documents groupés par type, dans l'ordre des types, puis par nom. */
export function grouperParType(
  docs: readonly VersionDocument[],
): { type: TypeDocument; documents: VersionDocument[] }[] {
  return TYPES_DOCUMENT.map((type) => ({
    type,
    documents: docs
      .filter((d) => d.type === type)
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" })),
  })).filter((g) => g.documents.length > 0);
}

/** Version courante identique (même empreinte) : détecté avant l'envoi pour épargner la 3G. */
export function memeContenu(sha256: string | null, courante: Pick<VersionDocument, "fichier">) {
  return sha256 !== null && courante.fichier !== null && courante.fichier.sha256 === sha256;
}

// --- Saisie d'un dépôt ------------------------------------------------------------------------

export interface SaisieDepot {
  type: string;
  nom: string;
  brouillonIa: boolean;
}

export type ChampDepot = "type" | "nom" | "fichier";

export interface ChargeDepot {
  type: TypeDocument;
  nom: string;
  statut_contenu?: "brouillon_ia";
}

export function validerDepot(
  s: SaisieDepot,
  typesPermis: readonly TypeDocument[],
  erreurFichier: string | null,
): Resultat<ChargeDepot, ChampDepot> {
  const erreurs: Partial<Record<ChampDepot, string>> = {};
  if (!(typesPermis as readonly string[]).includes(s.type))
    erreurs.type = "Choisissez le type de document.";
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du document.";
  else if (nom.length > 200) erreurs.nom = "200 caractères au plus.";
  if (erreurFichier) erreurs.fichier = erreurFichier;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      type: s.type as TypeDocument,
      nom,
      ...(s.brouillonIa ? { statut_contenu: "brouillon_ia" as const } : {}),
    },
  };
}

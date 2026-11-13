/**
 * Cascade stratégique en graphe (PLA-12) : types de la réponse de l'API, libellés des trous et
 * des nœuds, contrôle de la saisie d'un projet ou d'un jalon, chemins et messages. Logique
 * pure, testée dans `plan-cascade.test.ts`.
 *
 * Les trous (objectif sans KPI, initiative sans porteur…) et les taux de couverture sont
 * calculés par le moteur côté API (`analyserCascade`) : rien n'est recalculé ici.
 */
import {
  creerTraduire,
  STATUT_JALON_LIBELLES,
  STATUT_PROJET_LIBELLES,
  STATUTS_JALON,
  STATUTS_PROJET,
  type Langue,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { cheminPlan, hrefPlan } from "./plan-strategique";

export type TypeNoeud = "vision" | "axe" | "objectif" | "initiative" | "projet" | "jalon" | "kpi";
export type Gravite = "bloquant" | "important" | "information";

export interface NoeudCascade {
  id: string;
  type: TypeNoeud;
  parent_id: string | null;
  titre: string;
  porteur_id: string | null;
  actif: boolean;
  profondeur: number;
  enfants: string[];
  orphelin: boolean;
  trous: string[];
  /** Projet ou jalon seulement (sinon null). */
  description: string | null;
  debut: string | null;
  echeance: string | null;
  statut: string | null;
  /** Projet ou jalon : se modifie depuis cet écran. */
  modifiable: boolean;
}

export interface TrouCascade {
  code: string;
  gravite: Gravite;
  noeud_id: string | null;
  type: TypeNoeud | null;
}

export interface CascadePlan {
  plan_id: string;
  reference: string;
  racines: string[];
  noeuds: NoeudCascade[];
  trous: TrouCascade[];
  compteurs: Record<TypeNoeud, number>;
  couverture: {
    noeuds_actifs: number;
    noeuds_avec_porteur: number;
    taux_porteurs: number;
    objectifs: number;
    objectifs_avec_kpi: number;
    taux_kpi: number;
  };
  synthese: Record<Gravite, number>;
  porteurs: Record<string, string>;
}

export const TYPE_NOEUD_LIBELLES: Record<TypeNoeud, string> = {
  vision: "Vision",
  axe: "Axe",
  objectif: "Objectif",
  initiative: "Initiative",
  projet: "Projet",
  jalon: "Jalon",
  kpi: "KPI",
};

export const TYPE_NOEUD_LIBELLES_EN: Record<TypeNoeud, string> = {
  vision: "Vision",
  axe: "Axis",
  objectif: "Objective",
  initiative: "Initiative",
  projet: "Project",
  jalon: "Milestone",
  kpi: "KPI",
};

export const libelleTypeNoeud = (t: TypeNoeud, langue: Langue = "fr") =>
  (langue === "en" ? TYPE_NOEUD_LIBELLES_EN : TYPE_NOEUD_LIBELLES)[t];

const STATUT_PROJET_LIBELLES_EN: Record<(typeof STATUTS_PROJET)[number], string> = {
  a_lancer: "To launch",
  en_cours: "In progress",
  termine: "Completed",
  suspendu: "On hold",
  abandonne: "Abandoned",
};

const STATUT_JALON_LIBELLES_EN: Record<(typeof STATUTS_JALON)[number], string> = {
  prevu: "Planned",
  atteint: "Achieved",
  manque: "Missed",
};

const TROUS_EN: Record<string, string> = {
  VISION_ABSENTE: "The plan has no vision: write the vision and mission.",
  SANS_PORTEUR: "No owner",
  AXE_SANS_OBJECTIF: "Axis without objective",
  OBJECTIF_SANS_KPI: "Objective without KPI",
  OBJECTIF_SANS_INITIATIVE: "Objective without initiative",
  INITIATIVE_HORS_OBJECTIF: "Initiative attached to an axis, with no measurable objective",
  INITIATIVE_SANS_PROJET: "Initiative without project",
  PROJET_SANS_JALON: "Project without milestone",
  JALON_EN_RETARD: "Planned milestone whose due date has passed",
  NOEUD_ORPHELIN: "Link lost (parent removed or incompatible)",
};

const TROUS: Record<string, string> = {
  VISION_ABSENTE: "Le plan n'a pas de vision : rédigez la vision et la mission.",
  SANS_PORTEUR: "Sans porteur",
  AXE_SANS_OBJECTIF: "Axe sans objectif",
  OBJECTIF_SANS_KPI: "Objectif sans KPI",
  OBJECTIF_SANS_INITIATIVE: "Objectif sans initiative",
  INITIATIVE_HORS_OBJECTIF: "Initiative rattachée à un axe, sans objectif mesurable",
  INITIATIVE_SANS_PROJET: "Initiative sans projet",
  PROJET_SANS_JALON: "Projet sans jalon",
  JALON_EN_RETARD: "Jalon prévu dont l'échéance est passée",
  NOEUD_ORPHELIN: "Rattachement perdu (parent retiré ou incompatible)",
};

export const libelleTrou = (code: string, langue: Langue = "fr") =>
  (langue === "en" ? TROUS_EN : TROUS)[code] ??
  (langue === "en" ? "Unrecognized gap" : "Écart non reconnu");

export const GRAVITE_LIBELLES: Record<Gravite, string> = {
  bloquant: "Bloquant",
  important: "Important",
  information: "Information",
};

export const GRAVITE_LIBELLES_EN: Record<Gravite, string> = {
  bloquant: "Blocking",
  important: "Important",
  information: "Information",
};

export const libelleGravite = (g: Gravite, langue: Langue = "fr") =>
  (langue === "en" ? GRAVITE_LIBELLES_EN : GRAVITE_LIBELLES)[g];

export const TONALITE_GRAVITE: Record<Gravite, TonaliteStatut> = {
  bloquant: "danger",
  important: "attention",
  information: "neutre",
};

/** Trous groupés par gravité, du plus grave au moins grave, avec le titre du nœud concerné. */
export function trousParGravite(c: Pick<CascadePlan, "trous" | "noeuds">, langue: Langue = "fr") {
  const titres = new Map(c.noeuds.map((n) => [n.id, n]));
  return (["bloquant", "important", "information"] as const)
    .map((gravite) => ({
      gravite,
      trous: c.trous
        .filter((t) => t.gravite === gravite)
        .map((t) => {
          const n = t.noeud_id ? titres.get(t.noeud_id) : undefined;
          const quoi = n
            ? langue === "en"
              ? `${libelleTypeNoeud(n.type, langue)} \u201c${n.titre}\u201d`
              : `${TYPE_NOEUD_LIBELLES[n.type]} « ${n.titre} »`
            : "Plan";
          return {
            ...t,
            texte: `${quoi}${langue === "en" ? ":" : " :"} ${libelleTrou(t.code, langue)}`,
          };
        }),
    }))
    .filter((g) => g.trous.length > 0);
}

/** Nom du porteur affiché, ou « Sans porteur ». */
export function libellePorteur(
  c: Pick<CascadePlan, "porteurs">,
  id: string | null,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (!id) return t("Sans porteur", "No owner");
  return c.porteurs[id] ?? t("Porteur hors liste", "Owner not in list");
}

/** Statut d'un projet ou d'un jalon. */
export function libelleStatutNoeud(
  type: TypeNoeud,
  statut: string | null,
  langue: Langue = "fr",
): string | null {
  if (!statut) return null;
  const en = langue === "en";
  if (type === "projet") {
    return (
      (en ? STATUT_PROJET_LIBELLES_EN : STATUT_PROJET_LIBELLES)[
        statut as keyof typeof STATUT_PROJET_LIBELLES
      ] ?? statut
    );
  }
  if (type === "jalon") {
    return (
      (en ? STATUT_JALON_LIBELLES_EN : STATUT_JALON_LIBELLES)[
        statut as keyof typeof STATUT_JALON_LIBELLES
      ] ?? statut
    );
  }
  return null;
}

/** Résumé de la couverture (« 5 nœuds sur 8 ont un porteur ; 1 objectif sur 2 a un KPI »). */
export function resumeCouverture(
  c: Pick<CascadePlan, "couverture">,
  langue: Langue = "fr",
): string {
  const k = c.couverture;
  if (langue === "en") {
    const porteursEn =
      k.noeuds_actifs === 0
        ? "No nodes"
        : `${k.noeuds_avec_porteur} of ${k.noeuds_actifs} node${k.noeuds_actifs > 1 ? "s" : ""} ${k.noeuds_avec_porteur > 1 ? "have" : "has"} an owner (${k.taux_porteurs} %)`;
    const kpiEn =
      k.objectifs === 0
        ? "no objectives"
        : `${k.objectifs_avec_kpi} of ${k.objectifs} objective${k.objectifs > 1 ? "s" : ""} ${k.objectifs_avec_kpi > 1 ? "have" : "has"} a KPI (${k.taux_kpi} %)`;
    return `${porteursEn}; ${kpiEn}.`;
  }
  // Plan vide : pas de « 0 sur 0 (100 %) », un taux sans dénominateur ne dit rien.
  const porteurs =
    k.noeuds_actifs === 0
      ? "Aucun nœud"
      : `${k.noeuds_avec_porteur} nœud${k.noeuds_avec_porteur > 1 ? "s" : ""} sur ${k.noeuds_actifs} ${k.noeuds_avec_porteur > 1 ? "ont" : "a"} un porteur (${k.taux_porteurs} %)`;
  const kpi =
    k.objectifs === 0
      ? "aucun objectif"
      : `${k.objectifs_avec_kpi} objectif${k.objectifs_avec_kpi > 1 ? "s" : ""} sur ${k.objectifs} ${k.objectifs_avec_kpi > 1 ? "ont" : "a"} un KPI (${k.taux_kpi} %)`;
  return `${porteurs} ; ${kpi}.`;
}

/* ----- Saisie d'un projet ou d'un jalon ----- */

export type TypeNoeudSaisi = "projet" | "jalon";

export interface SaisieNoeud {
  titre: string;
  description: string;
  porteur_id: string;
  debut: string;
  echeance: string;
  statut: string;
}

export const SAISIE_NOEUD_VIDE: SaisieNoeud = {
  titre: "",
  description: "",
  porteur_id: "",
  debut: "",
  echeance: "",
  statut: "",
};

export const optionsStatut = (type: TypeNoeudSaisi, langue: Langue = "fr") => {
  const en = langue === "en";
  return type === "projet"
    ? STATUTS_PROJET.map((s) => ({
        valeur: s,
        libelle: (en ? STATUT_PROJET_LIBELLES_EN : STATUT_PROJET_LIBELLES)[s],
      }))
    : STATUTS_JALON.map((s) => ({
        valeur: s,
        libelle: (en ? STATUT_JALON_LIBELLES_EN : STATUT_JALON_LIBELLES)[s],
      }));
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Saisie depuis un nœud existant (nouvelle version). */
export function saisieDepuisNoeud(n: NoeudCascade): SaisieNoeud {
  return {
    titre: n.titre,
    description: n.description ?? "",
    porteur_id: n.porteur_id ?? "",
    debut: n.debut ?? "",
    echeance: n.echeance ?? "",
    statut: n.statut ?? "",
  };
}

/** Bornes des dates métier (CHECK SQL de 0420 et schéma partagé `dateIsoBorneeSchema`). */
const MESSAGE_DATE_HORS_BORNES = "Date comprise entre 2000 et 2100 attendue.";
const MESSAGE_DATE_HORS_BORNES_EN = "A date between 2000 and 2100 is expected.";
const horsBornes = (d: string) => d < "2000-01-01" || d > "2100-12-31";

/** Contrôle et corps `donnees` attendu par l'API (un jalon n'a pas de date de début). */
export function validerNoeud(
  type: TypeNoeudSaisi,
  s: SaisieNoeud,
  langue: Langue = "fr",
): {
  erreurs: Partial<Record<keyof SaisieNoeud, string>>;
  donnees: Record<string, unknown> | null;
} {
  const t = creerTraduire(langue);
  const horsBornesMsg = t(MESSAGE_DATE_HORS_BORNES, MESSAGE_DATE_HORS_BORNES_EN);
  const erreurs: Partial<Record<keyof SaisieNoeud, string>> = {};
  const titre = s.titre.trim();
  if (!titre) erreurs.titre = t("Le titre est obligatoire.", "The title is required.");
  else if (titre.length > 200)
    erreurs.titre = t("200 caractères au plus.", "200 characters at most.");
  if (s.description.trim().length > 5000)
    erreurs.description = t("5 000 caractères au plus.", "5,000 characters at most.");
  if (!DATE.test(s.echeance))
    erreurs.echeance = t("L'échéance est obligatoire.", "The due date is required.");
  else if (horsBornes(s.echeance)) erreurs.echeance = horsBornesMsg;
  if (type === "projet" && s.debut && !DATE.test(s.debut))
    erreurs.debut = t("Date invalide.", "Invalid date.");
  else if (type === "projet" && s.debut && horsBornes(s.debut)) {
    erreurs.debut = horsBornesMsg;
  }
  if (
    type === "projet" &&
    !erreurs.debut &&
    DATE.test(s.debut) &&
    DATE.test(s.echeance) &&
    s.debut > s.echeance
  ) {
    erreurs.debut = t("Le début doit précéder l'échéance.", "The start must precede the due date.");
  }
  const statuts = optionsStatut(type).map((o) => o.valeur as string);
  if (s.statut && !statuts.includes(s.statut))
    erreurs.statut = t("Statut inconnu.", "Unknown status.");
  if (Object.keys(erreurs).length) return { erreurs, donnees: null };
  return {
    erreurs,
    donnees: {
      titre,
      description: s.description.trim() || null,
      porteur_id: s.porteur_id || null,
      ...(type === "projet" ? { debut: s.debut || null } : {}),
      echeance: s.echeance,
      ...(s.statut ? { statut: s.statut } : {}),
    },
  };
}

/** Message français d'un refus. */
export function messageCascade(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi) {
    if (e.statut === 404) {
      return langue === "en"
        ? "This plan or item cannot be found or is no longer accessible to you."
        : "Ce plan ou cet élément est introuvable ou ne vous est plus accessible.";
    }
    if (e.statut === 409) return e.message;
    if (e.statut === 400 && e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.") {
      return e.message;
    }
  }
  return messageErreur(e);
}

const seg = (id: string) => encodeURIComponent(id);

export const hrefCascade = (missionId: string, planId: string) =>
  `${hrefPlan(missionId, planId)}/cascade`;
export const cheminCascade = (planId: string) => `${cheminPlan(planId)}/cascade`;
export const cheminPorteur = (planId: string, elementId: string) =>
  `${cheminPlan(planId)}/elements/${seg(elementId)}/porteur`;
export const cheminNoeuds = (planId: string) => `${cheminPlan(planId)}/cascade/noeuds`;
export const cheminVersionNoeud = (planId: string, noeudId: string) =>
  `${cheminNoeuds(planId)}/${seg(noeudId)}/versions`;

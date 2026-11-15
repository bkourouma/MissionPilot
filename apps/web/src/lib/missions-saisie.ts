/** Missions : formulaire de création et de modification, et création depuis une proposition. */
import {
  creerTraduire,
  MODES_FACTURATION,
  type Langue,
  type ModeFacturation,
} from "@missionpilot/shared";
import { DEVISES, type Devise } from "./format";
import { DATE, UUID } from "./missions-motifs";
import type { Mission } from "./missions-types";
import { texteOuNull, type Resultat } from "./saisie";

// --- Formulaire mission (création et modification) -------------------------------------

export interface SaisieMission {
  intitule: string;
  client_id: string;
  type_mission_id: string;
  mode_facturation: string;
  directeur_id: string;
  chef_id: string;
  date_debut: string;
  date_fin: string;
  devise: string;
  activite: string;
  secteur: string;
  bureau: string;
}

export type ChampMission = keyof SaisieMission;

export const SAISIE_MISSION_VIDE: SaisieMission = {
  intitule: "",
  client_id: "",
  type_mission_id: "",
  mode_facturation: "",
  directeur_id: "",
  chef_id: "",
  date_debut: "",
  date_fin: "",
  devise: "XOF",
  activite: "",
  secteur: "",
  bureau: "",
};

export function saisieDepuisMission(m: Mission): SaisieMission {
  return {
    intitule: m.intitule,
    client_id: m.client_id,
    type_mission_id: m.type_mission_id ?? "",
    mode_facturation: m.mode_facturation,
    directeur_id: m.directeur_id ?? "",
    chef_id: m.chef_id ?? "",
    date_debut: m.date_debut ?? "",
    date_fin: m.date_fin ?? "",
    devise: m.devise,
    activite: m.activite ?? "",
    secteur: m.secteur ?? "",
    bureau: m.bureau ?? "",
  };
}

const idOuNull = (v: string) => (v === "" ? null : v);

interface ChampsCommunsMission {
  intitule: string;
  directeur_id: string | null;
  chef_id: string | null;
  date_debut: string | null;
  date_fin: string | null;
  devise: Devise;
  activite: string | null;
  secteur: string | null;
  bureau: string | null;
}

export interface ChargeCreationMission extends ChampsCommunsMission {
  client_id: string;
  type_mission_id: string | null;
  mode_facturation?: ModeFacturation;
}

export interface ChargeModificationMission extends Partial<ChampsCommunsMission> {
  mode_facturation?: ModeFacturation;
}

function validerCommun(
  s: SaisieMission,
  erreurs: Partial<Record<ChampMission, string>>,
  langue: Langue = "fr",
): ChampsCommunsMission {
  const t = creerTraduire(langue);
  const intitule = s.intitule.trim();
  if (intitule === "")
    erreurs.intitule = t("Saisissez l'intitulé de la mission.", "Enter the engagement title.");
  else if (intitule.length > 200)
    erreurs.intitule = t("200 caractères au plus.", "200 characters at most.");
  for (const champ of ["directeur_id", "chef_id"] as const) {
    if (s[champ] !== "" && !UUID.test(s[champ]))
      erreurs[champ] = t("Choisissez dans la liste.", "Choose from the list.");
  }
  for (const champ of ["date_debut", "date_fin"] as const) {
    if (s[champ] !== "" && !DATE.test(s[champ]))
      erreurs[champ] = t("Date invalide.", "Invalid date.");
  }
  if (!erreurs.date_fin && s.date_debut && s.date_fin && s.date_fin < s.date_debut)
    erreurs.date_fin = t(
      "La date de fin précède la date de début.",
      "The end date is before the start date.",
    );
  if (!(DEVISES as readonly string[]).includes(s.devise))
    erreurs.devise = t("Choisissez une devise.", "Choose a currency.");
  for (const champ of ["activite", "secteur", "bureau"] as const) {
    if (s[champ].trim().length > 120)
      erreurs[champ] = t("120 caractères au plus.", "120 characters at most.");
  }
  return {
    intitule,
    directeur_id: idOuNull(s.directeur_id),
    chef_id: idOuNull(s.chef_id),
    date_debut: idOuNull(s.date_debut),
    date_fin: idOuNull(s.date_fin),
    devise: s.devise as Devise,
    activite: texteOuNull(s.activite),
    secteur: texteOuNull(s.secteur),
    bureau: texteOuNull(s.bureau),
  };
}

const estMode = (v: string): v is ModeFacturation =>
  (MODES_FACTURATION as readonly string[]).includes(v);

/** Création : depuis un type du catalogue (mode par défaut du type) ou vierge (mode requis). */
export function validerCreationMission(
  s: SaisieMission,
  langue: Langue = "fr",
): Resultat<ChargeCreationMission, ChampMission> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampMission, string>> = {};
  const commun = validerCommun(s, erreurs, langue);
  if (!UUID.test(s.client_id)) erreurs.client_id = t("Choisissez le client.", "Choose the client.");
  if (s.type_mission_id !== "" && !UUID.test(s.type_mission_id))
    erreurs.type_mission_id = t(
      "Choisissez un type dans la liste.",
      "Choose a type from the list.",
    );
  if (s.mode_facturation !== "" && !estMode(s.mode_facturation))
    erreurs.mode_facturation = t("Choisissez un mode de facturation.", "Choose a billing mode.");
  if (s.type_mission_id === "" && s.mode_facturation === "")
    erreurs.mode_facturation = t(
      "Sans type de mission, choisissez le mode de facturation.",
      "Without an engagement type, choose the billing mode.",
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...commun,
      client_id: s.client_id,
      type_mission_id: idOuNull(s.type_mission_id),
      ...(estMode(s.mode_facturation) ? { mode_facturation: s.mode_facturation } : {}),
    },
  };
}

/**
 * Modification : devise et mode de facturation sont figés après signature (l'API refuse un
 * changement) ; le chef ne se réaffecte qu'avec « mission.modifier_toutes » et seul un associé
 * désigne le directeur (l'API répond 403 sinon).
 */
export function validerModificationMission(
  s: SaisieMission,
  options: { signee: boolean; reaffecter: boolean; designerDirecteur: boolean },
  langue: Langue = "fr",
): Resultat<ChargeModificationMission, ChampMission> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampMission, string>> = {};
  const { directeur_id, chef_id, devise, ...commun } = validerCommun(s, erreurs, langue);
  if (!options.signee && !estMode(s.mode_facturation))
    erreurs.mode_facturation = t("Choisissez un mode de facturation.", "Choose a billing mode.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...commun,
      ...(options.signee
        ? {}
        : { devise, mode_facturation: s.mode_facturation as ModeFacturation }),
      ...(options.reaffecter ? { chef_id } : {}),
      ...(options.designerDirecteur ? { directeur_id } : {}),
    },
  };
}

// --- Création depuis une proposition acceptée -----------------------------------------

export interface SaisieDepuisProposition {
  intitule: string;
  directeur_id: string;
  chef_id: string;
  date_debut: string;
  date_fin: string;
}

export function validerDepuisProposition(
  s: SaisieDepuisProposition,
  langue: Langue = "fr",
): Resultat<Record<string, string>, keyof SaisieDepuisProposition> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieDepuisProposition, string>> = {};
  const commun = validerCommun(
    { ...SAISIE_MISSION_VIDE, ...s, intitule: s.intitule || "x" },
    erreurs,
    langue,
  );
  const intitule = s.intitule.trim();
  if (intitule.length > 200)
    erreurs.intitule = t("200 caractères au plus.", "200 characters at most.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: Record<string, string> = {};
  if (intitule) charge.intitule = intitule;
  for (const champ of ["directeur_id", "chef_id", "date_debut", "date_fin"] as const) {
    const v = commun[champ];
    if (v) charge[champ] = v;
  }
  return { ok: true, charge };
}

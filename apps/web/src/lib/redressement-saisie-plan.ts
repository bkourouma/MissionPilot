/** Redressement (saisie) : actions du plan et leviers. */
import type {
  RedActionCreation,
  RedActionModification,
  RedDefinitionLevierVue,
  RedDomaine,
  RedImpactLevierVue,
  RedVolet,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { dateValide } from "./periode";
import { texteOuNull, type Resultat } from "./saisie";
import {
  type Erreurs,
  MSG_DATE,
  MSG_MONTANT,
  lireMontantRed,
  lireEntier,
} from "./redressement-saisie-base";
import { montantVersTexte } from "./redressement-saisie-tresorerie";

// --- Plan : actions et leviers ---------------------------------------------------------------------------------

export interface SaisieAction {
  titre: string;
  description: string;
  volet: RedVolet;
  domaine: RedDomaine;
  echeance: string;
  responsable_id: string;
  /** « » : aucun levier. */
  levier_code: string;
  parametres: Record<string, string>;
  creer_tache: boolean;
}
export type ChampAction =
  "titre" | "description" | "echeance" | "responsable_id" | "levier" | "parametres";

type DefinitionParametres = Pick<RedDefinitionLevierVue, "parametres">;

/** Paramètres saisis → entiers (montants en unités mineures de la devise, le reste tel quel). */
export function parametresDepuisSaisie(
  definition: DefinitionParametres,
  saisie: Readonly<Record<string, string>>,
  devise: Devise,
): { parametres: Record<string, number>; erreur: string | null } {
  const parametres: Record<string, number> = {};
  for (const p of definition.parametres) {
    const texte = saisie[p.cle] ?? "";
    if (texte.trim() === "") return { parametres, erreur: `Renseignez « ${p.libelle} ».` };
    const valeur =
      p.unite === "montant" ? lireMontantRed(texte, devise) : lireEntier(texte, p.min, p.max);
    if (valeur === null || Number.isNaN(valeur)) {
      return {
        parametres,
        erreur:
          p.unite === "montant"
            ? `« ${p.libelle} » : ${MSG_MONTANT(devise)}`
            : `« ${p.libelle} » : saisissez un entier entre ${p.min} et ${p.max}.`,
      };
    }
    parametres[p.cle] = valeur;
  }
  return { parametres, erreur: null };
}

/** Valeur d'un paramètre de l'API → texte du champ. */
export function parametresVersSaisie(
  definition: DefinitionParametres,
  parametres: Readonly<Record<string, number>>,
  devise: Devise,
): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const p of definition.parametres) {
    const v = parametres[p.cle];
    if (v === undefined) continue;
    sortie[p.cle] = p.unite === "montant" ? montantVersTexte(v, devise) : String(v);
  }
  return sortie;
}

/** Corps de création (route 30) ou de modification (route 31) d'une action. */
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "creation",
): Resultat<RedActionCreation, ChampAction>;
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "modification",
): Resultat<RedActionModification, ChampAction>;
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "creation" | "modification",
): Resultat<RedActionCreation | RedActionModification, ChampAction> {
  const erreurs: Erreurs<ChampAction> = {};
  const titre = s.titre.trim();
  if (titre === "") erreurs.titre = "Saisissez le titre de l'action.";
  else if (titre.length > 200) erreurs.titre = "Le titre compte 200 caractères au plus.";
  const description = texteOuNull(s.description);
  if (description !== null && description.length > 2000) {
    erreurs.description = "La description compte 2 000 caractères au plus.";
  }
  if (dateValide(s.echeance) === null) erreurs.echeance = MSG_DATE;
  if (s.responsable_id === "") erreurs.responsable_id = "Choisissez le responsable.";
  let levier: NonNullable<RedActionCreation["levier"]> | null = null;
  if (s.levier_code !== "") {
    const definition = definitions.find((d) => d.code === s.levier_code);
    if (!definition) erreurs.levier = "Levier inconnu : rechargez la page.";
    else {
      const p = parametresDepuisSaisie(definition, s.parametres, devise);
      if (p.erreur) erreurs.parametres = p.erreur;
      else levier = { code: definition.code, parametres: p.parametres };
    }
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  if (mode === "creation") {
    const charge: RedActionCreation = {
      titre,
      volet: s.volet,
      domaine: s.domaine,
      echeance: s.echeance,
      responsable_id: s.responsable_id,
      creer_tache: s.creer_tache,
    };
    if (description !== null) charge.description = description;
    if (levier !== null) charge.levier = levier;
    return { ok: true, charge };
  }
  const charge: RedActionModification = {
    titre,
    volet: s.volet,
    domaine: s.domaine,
    echeance: s.echeance,
    responsable_id: s.responsable_id,
    levier,
  };
  if (description !== null) charge.description = description;
  return { ok: true, charge };
}

/** Corps de la route 37 : le levier et ses paramètres. */
export function corpsSimulationDepuisFormulaire(
  definition: RedDefinitionLevierVue | undefined,
  saisie: Readonly<Record<string, string>>,
  devise: Devise,
): Resultat<
  { code: RedDefinitionLevierVue["code"]; parametres: Record<string, number> },
  "levier" | "parametres"
> {
  if (!definition) return { ok: false, erreurs: { levier: "Choisissez un levier." } };
  const p = parametresDepuisSaisie(definition, saisie, devise);
  if (p.erreur) return { ok: false, erreurs: { parametres: p.erreur } };
  return { ok: true, charge: { code: definition.code, parametres: p.parametres } };
}

/** Résumé d'impact pour l'affichage (« Plus ou moins-value » seulement pour une cession). */
export const aPlusOuMoinsValue = (impact: Pick<RedImpactLevierVue, "plus_ou_moins_value">) =>
  impact.plus_ou_moins_value !== null;

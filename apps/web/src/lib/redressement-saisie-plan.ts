/** Redressement (saisie) : actions du plan et leviers. */
import {
  creerTraduire,
  type Langue,
  type RedActionCreation,
  type RedActionModification,
  type RedDefinitionLevierVue,
  type RedDomaine,
  type RedImpactLevierVue,
  type RedVolet,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { dateValide } from "./periode";
import { texteOuNull, type Resultat } from "./saisie";
import {
  type Erreurs,
  msgDate,
  msgMontant,
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
  langue: Langue = "fr",
): { parametres: Record<string, number>; erreur: string | null } {
  const t = creerTraduire(langue);
  const parametres: Record<string, number> = {};
  for (const p of definition.parametres) {
    const texte = saisie[p.cle] ?? "";
    if (texte.trim() === "") {
      return { parametres, erreur: t(`Renseignez « ${p.libelle} ».`, `Fill in "${p.libelle}".`) };
    }
    const valeur =
      p.unite === "montant" ? lireMontantRed(texte, devise) : lireEntier(texte, p.min, p.max);
    if (valeur === null || Number.isNaN(valeur)) {
      return {
        parametres,
        erreur:
          p.unite === "montant"
            ? `« ${p.libelle} » : ${msgMontant(devise, langue)}`
            : t(
                `« ${p.libelle} » : saisissez un entier entre ${p.min} et ${p.max}.`,
                `"${p.libelle}": enter a whole number between ${p.min} and ${p.max}.`,
              ),
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
  langue?: Langue,
): Resultat<RedActionCreation, ChampAction>;
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "modification",
  langue?: Langue,
): Resultat<RedActionModification, ChampAction>;
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "creation" | "modification",
  langue: Langue = "fr",
): Resultat<RedActionCreation | RedActionModification, ChampAction> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<ChampAction> = {};
  const titre = s.titre.trim();
  if (titre === "") erreurs.titre = t("Saisissez le titre de l'action.", "Enter the action title.");
  else if (titre.length > 200) {
    erreurs.titre = t(
      "Le titre compte 200 caractères au plus.",
      "The title is 200 characters at most.",
    );
  }
  const description = texteOuNull(s.description);
  if (description !== null && description.length > 2000) {
    erreurs.description = t(
      "La description compte 2 000 caractères au plus.",
      "The description is 2,000 characters at most.",
    );
  }
  if (dateValide(s.echeance) === null) erreurs.echeance = msgDate(langue);
  if (s.responsable_id === "") {
    erreurs.responsable_id = t("Choisissez le responsable.", "Choose the owner.");
  }
  let levier: NonNullable<RedActionCreation["levier"]> | null = null;
  if (s.levier_code !== "") {
    const definition = definitions.find((d) => d.code === s.levier_code);
    if (!definition)
      erreurs.levier = t("Levier inconnu : rechargez la page.", "Unknown lever: reload the page.");
    else {
      const p = parametresDepuisSaisie(definition, s.parametres, devise, langue);
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
  langue: Langue = "fr",
): Resultat<
  { code: RedDefinitionLevierVue["code"]; parametres: Record<string, number> },
  "levier" | "parametres"
> {
  if (!definition) {
    return {
      ok: false,
      erreurs: { levier: creerTraduire(langue)("Choisissez un levier.", "Choose a lever.") },
    };
  }
  const p = parametresDepuisSaisie(definition, saisie, devise, langue);
  if (p.erreur) return { ok: false, erreurs: { parametres: p.erreur } };
  return { ok: true, charge: { code: definition.code, parametres: p.parametres } };
}

/** Résumé d'impact pour l'affichage (« Plus ou moins-value » seulement pour une cession). */
export const aPlusOuMoinsValue = (impact: Pick<RedImpactLevierVue, "plus_ou_moins_value">) =>
  impact.plus_ou_moins_value !== null;

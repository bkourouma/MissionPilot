/** Redressement (saisie) : créanciers, créances, événements de négociation et paiements. */
import {
  RED_ECHEANCES_MAX,
  type RedCategorieCreancier,
  type RedCreanceCreation,
  type RedCreancierCreation,
  type RedEvenementNegociation,
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

// --- Créanciers -------------------------------------------------------------------------------------------

export interface SaisieCreancier {
  nom: string;
  categorie: RedCategorieCreancier;
  garanti: boolean;
  reference: string;
  principal: string;
  interets: string;
  date_arrete: string;
  echeance_initiale: string;
  nature: string;
}
export type ChampCreancier = keyof SaisieCreancier;

function lireCreance(
  s: Pick<
    SaisieCreancier,
    "principal" | "interets" | "date_arrete" | "echeance_initiale" | "nature"
  >,
  devise: Devise,
  erreurs: Erreurs<ChampCreancier>,
): {
  principal: number;
  interets: number;
  date_arrete: string;
  echeance_initiale: string | null;
  nature: string | null;
} {
  const principal = lireMontantRed(s.principal, devise);
  if (principal === null) erreurs.principal = "Saisissez le montant principal.";
  else if (Number.isNaN(principal)) erreurs.principal = MSG_MONTANT(devise);
  const interets = s.interets.trim() === "" ? 0 : lireMontantRed(s.interets, devise);
  if (interets === null || Number.isNaN(interets)) erreurs.interets = MSG_MONTANT(devise);
  if (dateValide(s.date_arrete) === null) erreurs.date_arrete = MSG_DATE;
  const echeance = texteOuNull(s.echeance_initiale);
  if (echeance !== null && dateValide(echeance) === null) erreurs.echeance_initiale = MSG_DATE;
  const nature = texteOuNull(s.nature);
  if (nature !== null && nature.length > 200)
    erreurs.nature = "La nature compte 200 caractères au plus.";
  return {
    principal: principal ?? 0,
    interets: interets ?? 0,
    date_arrete: s.date_arrete,
    echeance_initiale: echeance,
    nature,
  };
}

export function corpsCreancierDepuisFormulaire(
  s: SaisieCreancier,
  devise: Devise,
): Resultat<RedCreancierCreation, ChampCreancier> {
  const erreurs: Erreurs<ChampCreancier> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du créancier.";
  else if (nom.length > 200) erreurs.nom = "Le nom compte 200 caractères au plus.";
  const reference = texteOuNull(s.reference);
  if (reference !== null && reference.length > 120) {
    erreurs.reference = "La référence compte 120 caractères au plus.";
  }
  const c = lireCreance(s, devise, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedCreancierCreation = {
    nom,
    categorie: s.categorie,
    garanti: s.garanti,
    principal: c.principal,
    interets: c.interets,
    date_arrete: c.date_arrete,
  };
  if (reference !== null) charge.reference = reference;
  if (c.echeance_initiale !== null) charge.echeance_initiale = c.echeance_initiale;
  if (c.nature !== null) charge.nature = c.nature;
  return { ok: true, charge };
}

export interface SaisieCreance {
  principal: string;
  interets: string;
  date_arrete: string;
  echeance_initiale: string;
  nature: string;
  commentaire: string;
}
export type ChampCreance = keyof SaisieCreance;

export function corpsCreanceDepuisFormulaire(
  s: SaisieCreance,
  devise: Devise,
): Resultat<RedCreanceCreation, ChampCreance> {
  const erreurs: Erreurs<ChampCreancier> = {};
  const c = lireCreance(s, devise, erreurs);
  const commentaire = texteOuNull(s.commentaire);
  const e: Erreurs<ChampCreance> = { ...erreurs };
  if (commentaire !== null && commentaire.length > 1000) {
    e.commentaire = "Le commentaire compte 1 000 caractères au plus.";
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  const charge: RedCreanceCreation = {
    principal: c.principal,
    interets: c.interets,
    date_arrete: c.date_arrete,
  };
  if (c.echeance_initiale !== null) charge.echeance_initiale = c.echeance_initiale;
  if (c.nature !== null) charge.nature = c.nature;
  if (commentaire !== null) charge.commentaire = commentaire;
  return { ok: true, charge };
}

export interface SaisieLigneEcheance {
  cle: string;
  date: string;
  montant: string;
}
export interface SaisieEvenement {
  type: RedEvenementNegociation["type"];
  date_evenement: string;
  montant: string;
  conditions: string;
  accord_id: string;
  /** « » : paiement non rattaché à une échéance. */
  echeance_rang: string;
  mode: "regulier" | "explicite";
  nombre_echeances: string;
  date_premiere: string;
  periodicite_mois: string;
  lignes: SaisieLigneEcheance[];
}
export type ChampEvenement =
  | "date_evenement"
  | "montant"
  | "conditions"
  | "accord_id"
  | "echeance_rang"
  | "nombre_echeances"
  | "date_premiere"
  | "periodicite_mois"
  | "lignes";

export const evenementVide = (aujourdhui: string, accordId = ""): SaisieEvenement => ({
  type: "note",
  date_evenement: aujourdhui,
  montant: "",
  conditions: "",
  accord_id: accordId,
  echeance_rang: "",
  mode: "regulier",
  nombre_echeances: "12",
  date_premiere: aujourdhui,
  periodicite_mois: "1",
  lignes: [],
});

/** Corps de la route 28 selon le type d'événement ; l'imputation des paiements est celle de l'API. */
export function corpsEvenementDepuisFormulaire(
  s: SaisieEvenement,
  devise: Devise,
): Resultat<RedEvenementNegociation, ChampEvenement> {
  const erreurs: Erreurs<ChampEvenement> = {};
  if (dateValide(s.date_evenement) === null) erreurs.date_evenement = MSG_DATE;
  const conditions = texteOuNull(s.conditions);
  if (conditions !== null && conditions.length > 2000) {
    erreurs.conditions = "Les conditions comptent 2 000 caractères au plus.";
  }
  const montantTexte = s.montant;
  const montant = lireMontantRed(montantTexte, devise);
  if (montant !== null && Number.isNaN(montant)) erreurs.montant = MSG_MONTANT(devise);
  const positif = () => {
    if (montant === null) erreurs.montant = "Saisissez le montant.";
    else if (!Number.isNaN(montant) && montant < 1)
      erreurs.montant = "Le montant doit être supérieur à zéro.";
  };

  if (s.type === "accord") {
    positif();
    let echeancier: Extract<RedEvenementNegociation, { type: "accord" }>["echeancier"] | null =
      null;
    if (s.mode === "regulier") {
      const n = lireEntier(s.nombre_echeances, 1, RED_ECHEANCES_MAX);
      if (n === null || Number.isNaN(n)) {
        erreurs.nombre_echeances = `Nombre d'échéances : entier de 1 à ${RED_ECHEANCES_MAX}.`;
      }
      if (dateValide(s.date_premiere) === null) erreurs.date_premiere = MSG_DATE;
      const p = lireEntier(s.periodicite_mois, 1, 12);
      if (p === null || Number.isNaN(p))
        erreurs.periodicite_mois = "Périodicité : entier de 1 à 12 mois.";
      if (!erreurs.nombre_echeances && !erreurs.date_premiere && !erreurs.periodicite_mois) {
        echeancier = {
          mode: "regulier",
          nombre_echeances: n as number,
          date_premiere: s.date_premiere,
          periodicite_mois: p as number,
        };
      }
    } else {
      const lignes: { date: string; montant: number }[] = [];
      if (s.lignes.length === 0) erreurs.lignes = "Ajoutez au moins une échéance.";
      else if (s.lignes.length > RED_ECHEANCES_MAX) {
        erreurs.lignes = `${RED_ECHEANCES_MAX} échéances au plus.`;
      }
      s.lignes.forEach((l, i) => {
        if (erreurs.lignes) return;
        if (dateValide(l.date) === null) {
          erreurs.lignes = `Échéance ${i + 1} : ${MSG_DATE}`;
          return;
        }
        const m = lireMontantRed(l.montant, devise);
        if (m === null || Number.isNaN(m) || m < 1) {
          erreurs.lignes = `Échéance ${i + 1} : saisissez un montant supérieur à zéro.`;
          return;
        }
        lignes.push({ date: l.date, montant: m });
      });
      if (!erreurs.lignes) echeancier = { mode: "explicite", lignes };
    }
    if (Object.keys(erreurs).length > 0 || echeancier === null || montant === null) {
      return { ok: false, erreurs };
    }
    const charge: RedEvenementNegociation = {
      type: "accord",
      date_evenement: s.date_evenement,
      montant,
      echeancier,
    };
    if (conditions !== null) charge.conditions = conditions;
    return { ok: true, charge };
  }

  if (s.type === "paiement") {
    positif();
    if (s.accord_id === "")
      erreurs.accord_id = "Aucun accord en vigueur : enregistrez d'abord un accord.";
    const rang =
      s.echeance_rang.trim() === "" ? null : lireEntier(s.echeance_rang, 1, RED_ECHEANCES_MAX);
    if (rang !== null && Number.isNaN(rang))
      erreurs.echeance_rang = "Choisissez une échéance de la liste.";
    if (Object.keys(erreurs).length > 0 || montant === null) return { ok: false, erreurs };
    const charge: RedEvenementNegociation = {
      type: "paiement",
      date_evenement: s.date_evenement,
      montant: montant as number,
      accord_id: s.accord_id,
    };
    if (rang !== null) charge.echeance_rang = rang;
    return { ok: true, charge };
  }

  if (s.type === "rupture") {
    if (s.accord_id === "") erreurs.accord_id = "Aucun accord en vigueur à rompre.";
    if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
    const charge: RedEvenementNegociation = {
      type: "rupture",
      date_evenement: s.date_evenement,
      accord_id: s.accord_id,
    };
    if (conditions !== null) charge.conditions = conditions;
    return { ok: true, charge };
  }

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge = {
    type: s.type,
    date_evenement: s.date_evenement,
    ...(montant !== null ? { montant } : {}),
    ...(conditions !== null ? { conditions } : {}),
  } as RedEvenementNegociation;
  return { ok: true, charge };
}

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps de l'annulation d'un paiement : l'événement vise le paiement par son identifiant. */
export function corpsAnnulationPaiement(
  paiementId: string,
  dateEvenement: string,
): Resultat<
  Extract<RedEvenementNegociation, { type: "annulation_paiement" }>,
  "paiement_annule_id" | "date_evenement"
> {
  const erreurs: Erreurs<"paiement_annule_id" | "date_evenement"> = {};
  if (!FORMAT_UUID.test(paiementId)) erreurs.paiement_annule_id = "Paiement à annuler inconnu.";
  if (dateValide(dateEvenement) === null) erreurs.date_evenement = MSG_DATE;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      type: "annulation_paiement",
      date_evenement: dateEvenement,
      paiement_annule_id: paiementId,
    },
  };
}

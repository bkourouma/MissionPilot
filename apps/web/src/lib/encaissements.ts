/**
 * Encaissements, imputations, contre-passations et statut de paiement des factures (FIN-09) :
 * logique pure, testée dans `encaissements.test.ts`.
 *
 * AUCUN montant n'est calculé ici : soldes, restes à payer, part non imputée et statut de
 * paiement viennent de l'API (moteur `@missionpilot/engines`). Les contrôles locaux ne font
 * que lire les saisies et les comparer aux valeurs servies, pour un message immédiat ; l'API
 * reste seule juge (trop-perçu, séparation des tâches).
 */
import {
  MODES_ENCAISSEMENT,
  OPERATEURS_MOBILE_MONEY,
  type ModeEncaissement,
  type OperateurMobileMoney,
  type Role,
  type StatutPaiement,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { DEVISES, type Devise } from "./format";
import { dateValide } from "./periode";
import { lireMontant, texteOuNull, type Resultat } from "./saisie";

// --- Contrats de l'API ---------------------------------------------------------------------

export interface ImputationEncaissement {
  id: string;
  facture_id: string;
  facture_numero: string | null;
  montant: number;
  devise: Devise;
  origine: "saisie" | "avance" | "contre_passation";
  date_imputation: string;
}

export interface Encaissement {
  id: string;
  client_id: string;
  client_raison_sociale: string;
  date_encaissement: string;
  /** Unités mineures ; négatif pour une contre-passation. */
  montant: number;
  devise: Devise;
  mode: ModeEncaissement;
  operateur: OperateurMobileMoney | null;
  reference: string | null;
  commentaire: string | null;
  avance: boolean;
  /** Encaissement d'origine, si celui-ci est une contre-passation. */
  contre_passation_de: string | null;
  motif: string | null;
  saisi_par: string;
  valide_par: string | null;
  saisi_le: string;
  /** Contre-passation qui annule cet encaissement, s'il y en a une. */
  contre_passe_par: string | null;
}

export interface EncaissementDetaille extends Encaissement {
  non_impute: number;
  imputations: ImputationEncaissement[];
}

export type StatutContrePassation = "demandee" | "validee" | "rejetee";

export interface ContrePassation {
  id: string;
  encaissement_id: string;
  motif: string;
  statut: StatutContrePassation;
  demandee_par: string;
  demandee_le: string;
  decidee_par: string | null;
  decidee_le: string | null;
  motif_rejet: string | null;
  encaissement_negatif_id: string | null;
}

/** Facture émise restant due (`GET /api/finance/creances`). */
export interface Creance {
  facture_id: string;
  numero: string | null;
  mission_id: string;
  client_id: string;
  client_raison_sociale: string;
  date_emission: string | null;
  date_echeance: string | null;
  statut_paiement: StatutPaiement;
  devise: Devise;
  net_a_payer: number;
  encaisse: number;
  solde: number;
  jours_retard: number;
}

export interface RelanceFacture {
  id: string;
  niveau: number;
  mode: "automatique" | "manuelle";
  date_relance: string;
  jours_retard: number;
  email_envoye: boolean;
  email_prepare: boolean;
  cree_par: string | null;
  cree_le: string;
}

/**
 * `GET /api/factures/:id/paiement`. Les champs de situation sont absents pour une facture
 * non émise (brouillon) : l'API ne renvoie alors que les listes.
 */
export interface PaiementFacture {
  facture_id: string;
  date: string;
  statut_paiement?: StatutPaiement;
  devise?: Devise;
  net_a_payer?: number;
  encaisse?: number;
  solde?: number;
  jours_retard?: number;
  imputations: {
    id: string;
    encaissement_id: string;
    mode: ModeEncaissement;
    date_encaissement: string;
    montant: number;
    origine: ImputationEncaissement["origine"];
    date_imputation: string;
  }[];
  relances: RelanceFacture[];
}

// --- Libellés ------------------------------------------------------------------------------

export const MODE_LIBELLES: Record<ModeEncaissement, string> = {
  virement: "Virement",
  cheque: "Chèque",
  especes: "Espèces",
  mobile_money: "Mobile Money",
};

export const OPERATEUR_LIBELLES: Record<OperateurMobileMoney, string> = {
  orange_money: "Orange Money",
  mtn_momo: "MTN Mobile Money",
  wave: "Wave",
  moov_money: "Moov Money",
  autre: "Autre opérateur",
};

export const OPTIONS_MODES = MODES_ENCAISSEMENT.map((m) => ({
  valeur: m,
  libelle: MODE_LIBELLES[m],
}));
export const OPTIONS_OPERATEURS = OPERATEURS_MOBILE_MONEY.map((o) => ({
  valeur: o,
  libelle: OPERATEUR_LIBELLES[o],
}));
export const OPTIONS_DEVISES = DEVISES.map((d) => ({
  valeur: d,
  libelle: d === "XOF" ? "XOF (FCFA UEMOA)" : d === "XAF" ? "XAF (FCFA CEMAC)" : d,
}));

/** Statut de paiement dérivé : couleur, texte et icône (jamais la couleur seule). */
export const STATUT_PAIEMENT: Record<
  StatutPaiement,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  non_payee: { libelle: "Non payée", tonalite: "neutre" },
  partiellement_payee: { libelle: "Partiellement payée", tonalite: "attention" },
  soldee: { libelle: "Soldée", tonalite: "succes" },
  en_retard: { libelle: "En retard", tonalite: "danger" },
  annulee: { libelle: "Annulée", tonalite: "neutre" },
};

export const STATUT_CONTRE_PASSATION: Record<
  StatutContrePassation,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  demandee: { libelle: "À valider", tonalite: "attention" },
  validee: { libelle: "Validée", tonalite: "succes" },
  rejetee: { libelle: "Rejetée", tonalite: "neutre" },
};

export const ORIGINE_IMPUTATION: Record<ImputationEncaissement["origine"], string> = {
  saisie: "À la saisie",
  avance: "Imputation d'avance",
  contre_passation: "Contre-passation",
};

/** Libellé du moyen de paiement : « Mobile Money (Wave) », « Chèque ». */
export function libelleMoyen(e: Pick<Encaissement, "mode" | "operateur">): string {
  const base = MODE_LIBELLES[e.mode] ?? e.mode;
  return e.mode === "mobile_money" && e.operateur
    ? `${base} (${OPERATEUR_LIBELLES[e.operateur]})`
    : base;
}

/** État affiché d'un encaissement : contre-passation, contre-passé, avance, imputé. */
export function etatEncaissement(e: Encaissement): { libelle: string; tonalite: TonaliteStatut } {
  if (e.contre_passation_de) return { libelle: "Contre-passation", tonalite: "neutre" };
  if (e.contre_passe_par) return { libelle: "Contre-passé", tonalite: "danger" };
  if (e.avance) return { libelle: "Avec avance", tonalite: "attention" };
  return { libelle: "Imputé", tonalite: "succes" };
}

// --- Règles d'actions (l'API reste seule juge) ----------------------------------------------

/**
 * Valider ou rejeter une contre-passation : un autre utilisateur que le demandeur, sauf
 * associé (séparation des tâches, règle de `finance/encaissements.ts`).
 */
export function peutDeciderContrePassation(
  d: Pick<ContrePassation, "statut" | "demandee_par">,
  utilisateurId: string,
  roles: readonly Role[],
): boolean {
  if (d.statut !== "demandee") return false;
  return d.demandee_par !== utilisateurId || roles.includes("associe");
}

export interface ActionsEncaissement {
  demanderContrePassation: boolean;
  imputerAvance: boolean;
}

export function actionsEncaissement(
  e: EncaissementDetaille,
  demandeEnAttente: boolean,
): ActionsEncaissement {
  const actif = e.contre_passation_de === null && e.contre_passe_par === null;
  return {
    demanderContrePassation: actif && !demandeEnAttente,
    imputerAvance: actif && e.non_impute > 0,
  };
}

// --- Saisie d'un encaissement ------------------------------------------------------------

export interface SaisieEncaissement {
  client_id: string;
  date: string;
  montant: string;
  devise: Devise;
  mode: ModeEncaissement | "";
  operateur: OperateurMobileMoney | "";
  reference: string;
  commentaire: string;
  /** Montant saisi par facture (texte), clé : identifiant de la facture. */
  imputations: Record<string, string>;
  avance: boolean;
}

export type ChampEncaissement =
  | "client_id"
  | "date"
  | "montant"
  | "mode"
  | "operateur"
  | "reference"
  | "commentaire"
  | "imputations";

export interface ChargeEncaissement {
  client_id: string;
  date: string;
  montant: number;
  devise: Devise;
  mode: ModeEncaissement;
  operateur: OperateurMobileMoney | null;
  reference: string | null;
  commentaire: string | null;
  imputations: { facture_id: string; montant: number }[];
  avance: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Imputations saisies → charge de l'API. Chaque montant est lu dans la devise et comparé au
 * reste à payer servi par l'API (refus du trop-perçu avant l'envoi) ; un champ vide est ignoré.
 */
export function lireImputations(
  saisies: Record<string, string>,
  creances: readonly Pick<Creance, "facture_id" | "numero" | "solde" | "devise">[],
  devise: Devise,
):
  | { ok: true; imputations: { facture_id: string; montant: number }[] }
  | { ok: false; erreur: string } {
  const imputations: { facture_id: string; montant: number }[] = [];
  for (const c of creances) {
    const texte = saisies[c.facture_id] ?? "";
    if (texte.trim() === "") continue;
    const nom = c.numero ? `la facture ${c.numero}` : "une facture";
    if (c.devise !== devise)
      return { ok: false, erreur: `Devise différente de celle de ${nom} : ne l'imputez pas ici.` };
    const m = lireMontant(texte, devise);
    if (m === null || Number.isNaN(m) || m <= 0)
      return { ok: false, erreur: `Montant imputé sur ${nom} : montant positif attendu.` };
    if (m > c.solde)
      return {
        ok: false,
        erreur: `Le montant imputé sur ${nom} dépasse son reste à payer : trop-perçu refusé. Imputez au plus le reste à payer et cochez « avance » pour le surplus.`,
      };
    imputations.push({ facture_id: c.facture_id, montant: m });
  }
  if (imputations.length > 50)
    return { ok: false, erreur: "50 factures au plus par encaissement." };
  return { ok: true, imputations };
}

export function validerEncaissement(
  s: SaisieEncaissement,
  creances: readonly Pick<Creance, "facture_id" | "numero" | "solde" | "devise">[],
  dateDuJour: string,
): Resultat<ChargeEncaissement, ChampEncaissement> {
  const erreurs: Partial<Record<ChampEncaissement, string>> = {};
  if (!UUID.test(s.client_id)) erreurs.client_id = "Choisissez le client qui a payé.";
  if (!dateValide(s.date)) erreurs.date = "Saisissez la date de l'encaissement.";
  else if (s.date > dateDuJour) erreurs.date = "Un encaissement ne se date pas dans le futur.";
  const montant = lireMontant(s.montant, s.devise);
  if (montant === null || Number.isNaN(montant) || montant <= 0)
    erreurs.montant = "Montant encaissé : nombre positif dans la devise choisie.";
  if (s.mode === "") erreurs.mode = "Choisissez le moyen de paiement.";
  if (s.mode === "mobile_money" && s.operateur === "")
    erreurs.operateur = "Précisez l'opérateur Mobile Money.";
  const reference = texteOuNull(s.reference);
  if ((s.mode === "cheque" || s.mode === "mobile_money") && !reference)
    erreurs.reference =
      s.mode === "cheque"
        ? "Saisissez le numéro du chèque."
        : "Saisissez la référence de l'opération Mobile Money.";
  else if (reference && (reference.length > 120 || /[\r\n]/.test(reference)))
    erreurs.reference = "Une seule ligne de 120 caractères au plus.";
  const commentaire = texteOuNull(s.commentaire);
  if (commentaire && commentaire.length > 500) erreurs.commentaire = "500 caractères au plus.";
  const imp = lireImputations(s.imputations, creances, s.devise);
  if (!imp.ok) erreurs.imputations = imp.erreur;
  if (Object.keys(erreurs).length > 0 || !imp.ok || s.mode === "") return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      client_id: s.client_id,
      date: s.date,
      montant: montant as number,
      devise: s.devise,
      mode: s.mode,
      operateur: s.mode === "mobile_money" ? (s.operateur as OperateurMobileMoney) : null,
      reference,
      commentaire,
      imputations: imp.imputations,
      avance: s.avance,
    },
  };
}

/** Imputation ultérieure d'une avance : au moins une facture, chacune ≤ son reste à payer. */
export function validerImputationAvance(
  saisies: Record<string, string>,
  creances: readonly Pick<Creance, "facture_id" | "numero" | "solde" | "devise">[],
  devise: Devise,
): Resultat<{ imputations: { facture_id: string; montant: number }[] }, "imputations"> {
  const imp = lireImputations(saisies, creances, devise);
  if (!imp.ok) return { ok: false, erreurs: { imputations: imp.erreur } };
  if (imp.imputations.length === 0)
    return {
      ok: false,
      erreurs: { imputations: "Saisissez le montant à imputer sur au moins une facture." },
    };
  return { ok: true, charge: { imputations: imp.imputations } };
}

/** Motif d'une contre-passation ou de son rejet : obligatoire, 500 caractères au plus. */
export function validerMotifContrePassation(motif: string): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "")
    return {
      ok: false,
      erreurs: { motif: "Le motif est obligatoire : il reste dans l'historique." },
    };
  if (m.length > 500) return { ok: false, erreurs: { motif: "500 caractères au plus." } };
  return { ok: true, charge: { motif: m } };
}

/** Message d'un refus métier des encaissements, en français et actionnable. */
export function messageEncaissement(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  switch (e.code) {
    case "TROP_PERCU":
    case "IMPUTATION_REFUSEE":
    case "HISTORIQUE_IMMUABLE":
    case "CONFLIT":
    case "VALIDATION_REQUISE":
      return e.message;
    case "CONFLIT_CONCURRENT":
      return "Une autre opération vient de modifier cet encaissement. Réessayez dans un instant.";
    case "REQUETE_INVALIDE":
      return e.message !== "Données invalides." ? e.message : null;
    default:
      return null;
  }
}

// --- Filtres de la liste -------------------------------------------------------------------

export interface FiltresEncaissements {
  client_id: string;
  du: string;
  au: string;
  curseur: string;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function lireFiltresEncaissements(
  p: Record<string, string | string[] | undefined>,
): FiltresEncaissements {
  const curseur = un(p.curseur);
  let du = dateValide(un(p.du)) ?? "";
  let au = dateValide(un(p.au)) ?? "";
  if (du && au && au < du) [du, au] = ["", ""];
  return {
    client_id: UUID.test(un(p.client_id)) ? un(p.client_id) : "",
    du,
    au,
    curseur: curseur.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseur) ? curseur : "",
  };
}

function parametres(f: FiltresEncaissements): URLSearchParams {
  const r = new URLSearchParams();
  if (f.client_id) r.set("client_id", f.client_id);
  if (f.du) r.set("du", f.du);
  if (f.au) r.set("au", f.au);
  if (f.curseur) r.set("curseur", f.curseur);
  return r;
}

export const TAILLE_PAGE_ENCAISSEMENTS = 30;

export function requeteEncaissements(f: FiltresEncaissements): string {
  const r = parametres(f);
  r.set("limite", String(TAILLE_PAGE_ENCAISSEMENTS));
  return r.toString();
}

export function hrefEncaissements(f: FiltresEncaissements, curseur?: string | null): string {
  const s = parametres({ ...f, curseur: curseur ?? "" }).toString();
  return s ? `/facturation/encaissements?${s}` : "/facturation/encaissements";
}

export const filtresEncaissementsActifs = (f: FiltresEncaissements) =>
  Boolean(f.client_id || f.du || f.au);

/**
 * Factures et avoirs (FIN-07, FIN-15) : logique pure, testée dans `factures.test.ts`.
 *
 * AUCUN montant n'est calculé ici : totaux, TVA par taux, retenues et net à payer viennent de
 * l'API (moteur `@missionpilot/engines`). Les règles d'actions reproduisent celles de
 * `routes/factures.ts` pour n'afficher que ce qui sera accepté ; l'API reste seule juge.
 */
import {
  aPermission,
  NATURES_FACTURE,
  STATUTS_FACTURE,
  type NatureFacture,
  type Role,
  type StatutFacture,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import type { Devise } from "./format";
import { lireMontant, lireNombre, texteOuNull, type Resultat } from "./saisie";

export type RoleApprobateur = "chef_mission" | "directeur_mission" | "associe";
export type TypeRemise = "pourcentage" | "montant";

export interface TvaParTaux {
  taux: number;
  base: number;
  montant: number;
}

export interface RetenueCalculee {
  libelle: string;
  taux: number;
  base: "HT" | "TTC";
  assiette: number;
  montant: number;
}

export interface Facture {
  id: string;
  nature: NatureFacture;
  facture_origine_id: string | null;
  mission_id: string;
  mission_intitule: string;
  client_id: string;
  client_raison_sociale: string;
  devise: Devise;
  statut: StatutFacture;
  objet: string | null;
  motif: string | null;
  numero: string | null;
  date_emission: string | null;
  date_echeance: string | null;
  delai_paiement_jours: number;
  remise_globale_type: TypeRemise | null;
  remise_globale_valeur: number | null;
  retenue_active: boolean;
  retenue_taux: number;
  retenue_base: "HT" | "TTC";
  retenue_libelle: string;
  total_brut: number;
  total_remises: number;
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  total_retenues: number;
  net_a_payer: number;
  tva: TvaParTaux[] | null;
  retenues: RetenueCalculee[] | null;
  role_approbateur: RoleApprobateur | null;
  motif_rejet: string | null;
  soumise_par: string | null;
  soumise_le: string | null;
  approuvee_par: string | null;
  approuvee_le: string | null;
  emise_par: string | null;
  emise_le: string | null;
  envoyee_le: string | null;
  annulee_le: string | null;
  annulee_par_avoir_id: string | null;
  cree_par: string;
  /** Personnes ayant modifié le brouillon (séparation des tâches), si l'API le fournit. */
  modifie_par?: string[] | null;
  cree_le: string;
  modifie_le: string;
}

export interface LigneFacture {
  id: string;
  ordre: number;
  origine: "echeance" | "debours";
  echeance_id: string | null;
  debours_id: string | null;
  libelle: string;
  quantite: number;
  prix_unitaire: number;
  taux_tva: number;
  remise_type: TypeRemise | null;
  remise_valeur: number | null;
  montant_brut: number;
  remise_ligne: number;
  part_remise_globale: number;
  montant_ht: number;
}

export interface FactureDetaillee extends Facture {
  lignes: LigneFacture[];
}

export const STATUT_FACTURE: Record<StatutFacture, { libelle: string; tonalite: TonaliteStatut }> =
  {
    brouillon: { libelle: "Brouillon", tonalite: "neutre" },
    a_approuver: { libelle: "À approuver", tonalite: "attention" },
    approuvee: { libelle: "Approuvée", tonalite: "succes" },
    emise: { libelle: "Émise", tonalite: "succes" },
    annulee: { libelle: "Annulée par avoir", tonalite: "danger" },
  };

export const NATURE_LIBELLES: Record<NatureFacture, string> = {
  facture: "Facture",
  avoir: "Avoir",
};

export const ROLE_APPROBATEUR_LIBELLES: Record<RoleApprobateur, string> = {
  chef_mission: "le directeur de la mission ou un associé",
  directeur_mission: "le directeur de la mission ou un associé",
  associe: "un associé",
};

export const OPTIONS_STATUTS_FACTURE = STATUTS_FACTURE.map((s) => ({
  valeur: s,
  libelle: STATUT_FACTURE[s].libelle,
}));
export const OPTIONS_NATURES = NATURES_FACTURE.map((n) => ({
  valeur: n,
  libelle: NATURE_LIBELLES[n],
}));

/** Désignation d'une facture : numéro définitif, sinon « Brouillon » ou « Avoir (brouillon) ». */
export function designationFacture(f: Pick<Facture, "nature" | "numero" | "statut">): string {
  if (f.numero) return `${NATURE_LIBELLES[f.nature]} ${f.numero}`;
  return f.nature === "avoir" ? "Avoir (sans numéro)" : "Facture (sans numéro)";
}

// --- Champs affichés (défense en profondeur) ---------------------------------------------

const CHAMPS_FACTURE: readonly (keyof Facture)[] = [
  "id",
  "nature",
  "facture_origine_id",
  "mission_id",
  "mission_intitule",
  "client_id",
  "client_raison_sociale",
  "devise",
  "statut",
  "objet",
  "motif",
  "numero",
  "date_emission",
  "date_echeance",
  "delai_paiement_jours",
  "remise_globale_type",
  "remise_globale_valeur",
  "retenue_active",
  "retenue_taux",
  "retenue_base",
  "retenue_libelle",
  "total_brut",
  "total_remises",
  "total_ht",
  "total_tva",
  "total_ttc",
  "total_retenues",
  "net_a_payer",
  "tva",
  "retenues",
  "role_approbateur",
  "motif_rejet",
  "soumise_par",
  "soumise_le",
  "approuvee_par",
  "approuvee_le",
  "emise_par",
  "emise_le",
  "envoyee_le",
  "annulee_le",
  "annulee_par_avoir_id",
  "cree_par",
  "modifie_par",
  "cree_le",
  "modifie_le",
];
const CHAMPS_LIGNE: readonly (keyof LigneFacture)[] = [
  "id",
  "ordre",
  "origine",
  "echeance_id",
  "debours_id",
  "libelle",
  "quantite",
  "prix_unitaire",
  "taux_tva",
  "remise_type",
  "remise_valeur",
  "montant_brut",
  "remise_ligne",
  "part_remise_globale",
  "montant_ht",
];

function choisir<T>(source: Record<string, unknown>, champs: readonly (keyof T)[]): T {
  return Object.fromEntries(champs.map((c) => [c, source[c as string] ?? null])) as unknown as T;
}

/**
 * Ne garde que les champs de facturation connus : aucune donnée de coût, de marge ou de
 * taux interne n'est rendue, même si l'API en ajoutait un jour (FIN-02).
 */
export function factureVisible(f: Facture): Facture {
  return choisir<Facture>(f as unknown as Record<string, unknown>, CHAMPS_FACTURE);
}

export function factureDetailleeVisible(f: FactureDetaillee): FactureDetaillee {
  return {
    ...factureVisible(f),
    lignes: (f.lignes ?? []).map((l) =>
      choisir<LigneFacture>(l as unknown as Record<string, unknown>, CHAMPS_LIGNE),
    ),
  };
}

// --- Actions selon le rôle et le statut ---------------------------------------------------

export interface ContexteFacture {
  roles: readonly Role[];
  utilisateurId: string;
  /** Directeur désigné de la mission de la facture. */
  directeurId: string | null;
}

export interface ActionsFacture {
  modifier: boolean;
  soumettre: boolean;
  supprimer: boolean;
  approuver: boolean;
  /** Pourquoi l'approbation est refusée à cet utilisateur (facture à approuver), sinon null. */
  raisonRefusApprobation: string | null;
  rejeter: boolean;
  emettre: boolean;
  avoir: boolean;
  marquerEnvoyee: boolean;
}

const RANG: Record<RoleApprobateur, readonly Role[]> = {
  chef_mission: ["chef_mission", "directeur_mission", "associe"],
  directeur_mission: ["directeur_mission", "associe"],
  associe: ["associe"],
};

function refusApprobation(f: Facture, c: ContexteFacture): string | null {
  const associe = c.roles.includes("associe");
  const requis = f.role_approbateur ?? "associe";
  if (!aPermission(c.roles, "facture.valider"))
    return "Votre rôle ne permet pas d'approuver une facture.";
  if (!associe && c.directeurId !== c.utilisateurId)
    return `Cette facture est approuvée par ${ROLE_APPROBATEUR_LIBELLES[requis]}.`;
  const auteur =
    f.cree_par === c.utilisateurId ||
    f.soumise_par === c.utilisateurId ||
    (f.modifie_par ?? []).includes(c.utilisateurId);
  if (!associe && auteur)
    return "Vous avez préparé ou soumis cette facture : elle est approuvée par un associé.";
  if (!c.roles.some((r) => RANG[requis].includes(r)))
    return `Cette facture est approuvée par ${ROLE_APPROBATEUR_LIBELLES[requis]}.`;
  return null;
}

export function actionsFacture(f: Facture, c: ContexteFacture): ActionsFacture {
  const emettre = aPermission(c.roles, "facture.emettre");
  const associe = c.roles.includes("associe");
  const brouillon = f.statut === "brouillon";
  const aApprouver = f.statut === "a_approuver";
  const refus = aApprouver ? refusApprobation(f, c) : null;
  const decideur =
    aPermission(c.roles, "facture.valider") && (associe || c.directeurId === c.utilisateurId);
  const emise = f.statut === "emise";
  return {
    modifier: emettre && brouillon && f.nature === "facture",
    soumettre: emettre && brouillon,
    supprimer: emettre && brouillon,
    approuver: aApprouver && refus === null,
    raisonRefusApprobation: refus,
    rejeter: aApprouver && decideur,
    emettre: emettre && f.statut === "approuvee",
    avoir: emettre && emise && f.nature === "facture" && f.annulee_par_avoir_id === null,
    marquerEnvoyee: emettre && emise && f.envoyee_le === null,
  };
}

// --- Filtres de la liste ---------------------------------------------------------------------

export interface FiltresFactures {
  statut: StatutFacture | "";
  nature: NatureFacture | "";
  client_id: string;
  mission_id: string;
  curseur: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function lireFiltresFactures(
  p: Record<string, string | string[] | undefined>,
): FiltresFactures {
  const statut = un(p.statut);
  const nature = un(p.nature);
  const curseur = un(p.curseur);
  return {
    statut: (STATUTS_FACTURE as readonly string[]).includes(statut)
      ? (statut as StatutFacture)
      : "",
    nature: (NATURES_FACTURE as readonly string[]).includes(nature)
      ? (nature as NatureFacture)
      : "",
    client_id: UUID.test(un(p.client_id)) ? un(p.client_id) : "",
    mission_id: UUID.test(un(p.mission_id)) ? un(p.mission_id) : "",
    curseur: curseur.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseur) ? curseur : "",
  };
}

function parametres(f: FiltresFactures, avecCurseur: boolean): URLSearchParams {
  const r = new URLSearchParams();
  if (f.statut) r.set("statut", f.statut);
  if (f.nature) r.set("nature", f.nature);
  if (f.client_id) r.set("client_id", f.client_id);
  if (f.mission_id) r.set("mission_id", f.mission_id);
  if (avecCurseur && f.curseur) r.set("curseur", f.curseur);
  return r;
}

export const TAILLE_PAGE_FACTURES = 30;

export function requeteFactures(f: FiltresFactures): string {
  const r = parametres(f, true);
  r.set("limite", String(TAILLE_PAGE_FACTURES));
  return r.toString();
}

export function hrefFactures(f: FiltresFactures, curseur?: string | null): string {
  const r = parametres({ ...f, curseur: curseur ?? "" }, true);
  const s = r.toString();
  return s ? `/facturation?${s}` : "/facturation";
}

export const filtresActifs = (f: FiltresFactures) =>
  Boolean(f.statut || f.nature || f.client_id || f.mission_id);

// --- Saisies -------------------------------------------------------------------------------

export interface SaisieRemise {
  type: TypeRemise | "";
  valeur: string;
}

/** Remise saisie → charge de l'API ; `null` sans remise ; `undefined` si invalide. */
export function lireRemise(
  s: SaisieRemise,
  devise: Devise,
): { type: TypeRemise; valeur: number } | null | undefined {
  if (s.type === "") return null;
  if (s.type === "pourcentage") {
    const n = lireNombre(s.valeur);
    if (n === null || Number.isNaN(n) || n < 0 || n > 100) return undefined;
    if (Math.abs(n * 10_000 - Math.round(n * 10_000)) > 1e-6) return undefined;
    return { type: "pourcentage", valeur: n };
  }
  const m = lireMontant(s.valeur, devise);
  if (m === null || Number.isNaN(m)) return undefined;
  return { type: "montant", valeur: m };
}

export const MESSAGE_REMISE =
  "Remise invalide : pourcentage de 0 à 100, ou montant positif dans la devise de la facture.";

export interface SaisieEnTete {
  objet: string;
  remise: SaisieRemise;
  retenue_active: boolean;
  delai_paiement_jours: string;
}
export type ChampEnTete = "objet" | "remise" | "delai_paiement_jours";

export function validerEnTete(
  s: SaisieEnTete,
  devise: Devise,
): Resultat<Record<string, unknown>, ChampEnTete> {
  const erreurs: Partial<Record<ChampEnTete, string>> = {};
  const objet = texteOuNull(s.objet);
  if (objet && objet.length > 300) erreurs.objet = "300 caractères au plus.";
  const remise = lireRemise(s.remise, devise);
  if (remise === undefined) erreurs.remise = MESSAGE_REMISE;
  const delai = lireNombre(s.delai_paiement_jours);
  if (delai === null || Number.isNaN(delai) || !Number.isInteger(delai) || delai < 0 || delai > 365)
    erreurs.delai_paiement_jours = "Nombre entier de jours, de 0 à 365.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      objet,
      remise_globale: remise,
      retenue_active: s.retenue_active,
      delai_paiement_jours: delai,
    },
  };
}

export interface SaisieLigne {
  libelle: string;
  taux_tva: string;
  remise: SaisieRemise;
}
export type ChampLigne = "libelle" | "taux_tva" | "remise";

export function validerLigne(
  s: SaisieLigne,
  devise: Devise,
  tauxAutorises: readonly number[],
): Resultat<Record<string, unknown>, ChampLigne> {
  const erreurs: Partial<Record<ChampLigne, string>> = {};
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = "Saisissez le libellé de la ligne.";
  else if (libelle.length > 300) erreurs.libelle = "300 caractères au plus.";
  const taux = lireNombre(s.taux_tva);
  if (taux === null || Number.isNaN(taux) || !tauxAutorises.includes(taux))
    erreurs.taux_tva = "Choisissez un taux de TVA autorisé par le cabinet.";
  const remise = lireRemise(s.remise, devise);
  if (remise === undefined) erreurs.remise = MESSAGE_REMISE;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { libelle, taux_tva: taux, remise } };
}

/** Motif d'un rejet ou d'un avoir : 1 à 500 caractères. */
export function validerMotif(motif: string): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "") return { ok: false, erreurs: { motif: "Saisissez un motif." } };
  if (m.length > 500) return { ok: false, erreurs: { motif: "500 caractères au plus." } };
  return { ok: true, charge: { motif: m } };
}

/** Création d'un brouillon depuis des échéances et des débours (au moins un élément). */
export function validerCreationFacture(s: {
  echeance_ids: readonly string[];
  debours_ids: readonly string[];
  objet: string;
}): Resultat<
  { echeance_ids: string[]; debours_ids: string[]; objet: string | null },
  "elements" | "objet"
> {
  const echeance_ids = [...new Set(s.echeance_ids)];
  const debours_ids = [...new Set(s.debours_ids)];
  const objet = texteOuNull(s.objet);
  const erreurs: Partial<Record<"elements" | "objet", string>> = {};
  if (echeance_ids.length + debours_ids.length === 0)
    erreurs.elements = "Cochez au moins une échéance à facturer ou un débours refacturable.";
  else if (echeance_ids.length > 50 || debours_ids.length > 200)
    erreurs.elements = "50 échéances et 200 débours au plus par facture.";
  if (objet && objet.length > 300) erreurs.objet = "300 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { echeance_ids, debours_ids, objet } };
}

/** Message d'un refus métier de la facturation, en français et actionnable. */
export function messageFacture(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  switch (e.code) {
    case "MENTIONS_INCOMPLETES":
      return `${e.message} Complétez-les dans Paramètres > Facturation.`;
    case "APPROBATION_REQUISE":
    case "FACTURE_FIGEE":
    case "NUMEROTATION":
    case "AVOIR_INVALIDE":
    case "CONFLIT":
      return e.message;
    default:
      return null;
  }
}

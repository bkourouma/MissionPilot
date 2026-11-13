/**
 * Débours et notes de frais (FIN-05) : logique pure, testée dans `debours.test.ts`.
 *
 * Le justificatif (photo ou scan) est un FICHIER téléversé à part, après l'enregistrement du
 * débours (POST /api/debours/:id/justificatif) : le corps JSON d'un débours ne porte jamais de
 * justificatif (l'API refuse toute valeur, 400 JUSTIFICATIF_PAR_TELEVERSEMENT). L'ancien champ
 * texte `justificatif` reste affiché pour les débours saisis avant le téléversement. Les règles
 * d'actions reproduisent `routes/debours.ts` ; l'API reste seule juge.
 */
import {
  aPermission,
  CATEGORIES_DEBOURS,
  creerTraduire,
  type Langue,
  STATUTS_DEBOURS,
  type CategorieDebours,
  type Role,
  type StatutDebours,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { FichierMeta } from "./fichiers";
import type { Devise } from "./format";
import { estDateIso } from "./semaine";
import { lireMontant, montantVersSaisie, type Resultat } from "./saisie";

export interface Debours {
  id: string;
  mission_id: string;
  collaborateur_id: string;
  collaborateur_nom: string;
  auteur_id: string;
  date: string;
  categorie: CategorieDebours;
  libelle: string;
  montant: number;
  devise: Devise;
  refacturable: boolean;
  /** Ancienne référence texte (débours antérieurs au téléversement), en lecture seule. */
  justificatif: string | null;
  justificatif_fichier_id: string | null;
  justificatif_fichier: FichierMeta | null;
  statut: StatutDebours;
  motif_rejet: string | null;
  soumis_le: string | null;
  decide_par: string | null;
  decide_le: string | null;
  cree_le: string;
  modifie_le: string;
}

export interface PageDebours {
  elements: Debours[];
  curseur_suivant: string | null;
}

export const CATEGORIE_LIBELLES: Record<CategorieDebours, string> = {
  transport: "Transport",
  hebergement: "Hébergement",
  restauration: "Restauration",
  per_diem: "Per diem",
  communication: "Communication",
  fournitures: "Fournitures",
  sous_traitance_locale: "Sous-traitance locale",
  autre: "Autre",
};

export const CATEGORIE_LIBELLES_EN: Record<CategorieDebours, string> = {
  transport: "Transport",
  hebergement: "Accommodation",
  restauration: "Meals",
  per_diem: "Per diem",
  communication: "Communication",
  fournitures: "Supplies",
  sous_traitance_locale: "Local subcontracting",
  autre: "Other",
};

export const libelleCategorie = (c: CategorieDebours, langue: Langue = "fr") =>
  (langue === "en" ? CATEGORIE_LIBELLES_EN : CATEGORIE_LIBELLES)[c];

export const OPTIONS_CATEGORIES = CATEGORIES_DEBOURS.map((c) => ({
  valeur: c,
  libelle: CATEGORIE_LIBELLES[c],
}));

export const optionsCategories = (langue: Langue = "fr") =>
  CATEGORIES_DEBOURS.map((c) => ({ valeur: c, libelle: libelleCategorie(c, langue) }));

export const STATUT_DEBOURS: Record<StatutDebours, { libelle: string; tonalite: TonaliteStatut }> =
  {
    brouillon: { libelle: "Brouillon", tonalite: "neutre" },
    soumis: { libelle: "Soumis", tonalite: "attention" },
    valide: { libelle: "Validé", tonalite: "succes" },
    rejete: { libelle: "Rejeté", tonalite: "danger" },
  };

export const STATUT_DEBOURS_EN: Record<
  StatutDebours,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  brouillon: { libelle: "Draft", tonalite: "neutre" },
  soumis: { libelle: "Submitted", tonalite: "attention" },
  valide: { libelle: "Approved", tonalite: "succes" },
  rejete: { libelle: "Rejected", tonalite: "danger" },
};

export const statutDebours = (s: StatutDebours, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_DEBOURS_EN : STATUT_DEBOURS)[s];

export const OPTIONS_STATUTS_DEBOURS = STATUTS_DEBOURS.map((s) => ({
  valeur: s,
  libelle: STATUT_DEBOURS[s].libelle,
}));

export const optionsStatutsDebours = (langue: Langue = "fr") =>
  STATUTS_DEBOURS.map((s) => ({ valeur: s, libelle: statutDebours(s, langue).libelle }));

export const lireStatutDebours = (v: string | string[] | undefined): StatutDebours | "" => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && (STATUTS_DEBOURS as readonly string[]).includes(s) ? (s as StatutDebours) : "";
};

// --- Saisie ----------------------------------------------------------------------------------

export interface SaisieDebours {
  date: string;
  categorie: string;
  libelle: string;
  montant: string;
  refacturable: boolean;
}

/** Champs du formulaire, plus le fichier du justificatif (contrôlé à part). */
export type ChampDebours = keyof SaisieDebours | "justificatif";

export const saisieDeboursVide = (date: string): SaisieDebours => ({
  date,
  categorie: "",
  libelle: "",
  montant: "",
  refacturable: true,
});

export function saisieDepuisDebours(d: Debours): SaisieDebours {
  return {
    date: d.date,
    categorie: d.categorie,
    libelle: d.libelle,
    montant: montantVersSaisie(d.montant, d.devise),
    refacturable: d.refacturable,
  };
}

export interface ChargeDebours {
  date: string;
  categorie: CategorieDebours;
  libelle: string;
  montant: number;
  devise: Devise;
  refacturable: boolean;
}

/** Valide un débours saisi dans la devise de la mission (montant strictement positif). */
export function validerDebours(
  s: SaisieDebours,
  devise: Devise,
  langue: Langue = "fr",
): Resultat<ChargeDebours, ChampDebours> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampDebours, string>> = {};
  if (!estDateIso(s.date) || s.date < "2000-01-01" || s.date > "2100-12-31")
    erreurs.date = t("Saisissez la date de la dépense.", "Enter the expense date.");
  if (!(CATEGORIES_DEBOURS as readonly string[]).includes(s.categorie))
    erreurs.categorie = t("Choisissez une catégorie.", "Choose a category.");
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = t(
      "Décrivez la dépense (ex. Taxi aéroport – hôtel).",
      "Describe the expense (e.g. Airport taxi – hotel).",
    );
  else if (libelle.length > 200)
    erreurs.libelle = t("200 caractères au plus.", "200 characters maximum.");
  const montant = lireMontant(s.montant, devise);
  if (montant === null)
    erreurs.montant = t("Saisissez le montant de la dépense.", "Enter the expense amount.");
  else if (Number.isNaN(montant) || montant <= 0)
    erreurs.montant =
      devise === "XOF" || devise === "XAF"
        ? t(
            "Montant positif, sans décimale (ex. 15 000).",
            "Positive amount, no decimals (e.g. 15,000).",
          )
        : t(
            "Montant positif, deux décimales au plus (ex. 45,50).",
            "Positive amount, up to two decimals (e.g. 45.50).",
          );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      date: s.date,
      categorie: s.categorie as CategorieDebours,
      libelle,
      montant: montant as number,
      devise,
      refacturable: s.refacturable,
    },
  };
}

// --- Actions ---------------------------------------------------------------------------------

export interface ContexteDebours {
  roles: readonly Role[];
  utilisateurId: string;
  chefId: string | null;
  directeurId: string | null;
  missionCloturee: boolean;
}

export interface ActionsDebours {
  modifier: boolean;
  soumettre: boolean;
  supprimer: boolean;
  valider: boolean;
  rejeter: boolean;
}

/** Valide les débours de la mission : associé, ou chef / directeur de CETTE mission. */
export function valideurDeMission(c: Omit<ContexteDebours, "missionCloturee">): boolean {
  return (
    c.roles.includes("associe") ||
    (aPermission(c.roles, "debours.valider") &&
      (c.chefId === c.utilisateurId || c.directeurId === c.utilisateurId))
  );
}

export function actionsDebours(
  d: Pick<Debours, "auteur_id" | "statut">,
  c: ContexteDebours,
): ActionsDebours {
  const auteur = d.auteur_id === c.utilisateurId;
  const modifiable = auteur && (d.statut === "brouillon" || d.statut === "rejete");
  const decision =
    d.statut === "soumis" && valideurDeMission(c) && (!auteur || c.roles.includes("associe"));
  return {
    modifier: modifiable,
    soumettre: modifiable && !c.missionCloturee,
    supprimer: modifiable,
    valider: decision,
    rejeter: decision,
  };
}

/** Débours refacturables validés : seuls candidats à une facture. */
export const deboursRefacturables = (liste: readonly Debours[]) =>
  liste.filter((d) => d.statut === "valide" && d.refacturable);

/** Le justificatif se change tant que le débours est en brouillon ou rejeté (son auteur). */
export const justificatifModifiable = (
  d: Pick<Debours, "auteur_id" | "statut">,
  utilisateurId: string,
) => d.auteur_id === utilisateurId && (d.statut === "brouillon" || d.statut === "rejete");

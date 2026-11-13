import {
  creerTraduire,
  LIBELLES_ROLE_REFERENCE,
  SECTIONS_OFFRE_TECHNIQUE,
  type Langue,
  type SectionOffreTechnique,
} from "@missionpilot/shared";
import { lireNiveauLangue } from "./banque-ao-saisie-cv";
import { champs, lignes, MOIS } from "./banque-ao-saisie-base";
import type { SectionsOffre } from "./banque-ao-types";
import type { Devise } from "./format";
import { lireMontant, lireNombre, texteOuNull, decouperListe, type Resultat } from "./saisie";

export interface SaisieExigences {
  annees_min: string;
  niveau_diplome_min: string;
  secteur: string;
  annees_secteur: string;
  langue: string;
  niveau_langue: string;
  reference: string;
}

/** Exigences d'un dossier d'appel d'offres (formulaire de contrôle d'un CV). */
export function lireExigences(
  s: SaisieExigences,
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, keyof SaisieExigences> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieExigences, string>> = {};
  const entier = (v: string, champ: keyof SaisieExigences) => {
    const n = lireNombre(v);
    if (n === null) return undefined;
    if (!Number.isInteger(n) || n < 0 || n > 60)
      erreurs[champ] = t("Entier de 0 à 60.", "Whole number from 0 to 60.");
    return n;
  };
  const annees = entier(s.annees_min, "annees_min");
  const anneesSecteur = entier(s.annees_secteur, "annees_secteur");
  if (s.secteur.trim() !== "" && anneesSecteur === undefined) {
    erreurs.annees_secteur = t(
      "Indiquez les années exigées dans ce secteur.",
      "Enter the years required in this sector.",
    );
  }
  const niveauLangue = s.langue.trim() === "" ? null : lireNiveauLangue(s.niveau_langue);
  if (s.langue.trim() !== "" && !niveauLangue)
    erreurs.niveau_langue = t("Choisissez le niveau.", "Choose the level.");
  if (s.reference !== "" && !MOIS.test(s.reference))
    erreurs.reference = t("Mois AAAA-MM attendu.", "Month in YYYY-MM format expected.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...(annees === undefined ? {} : { annees_min: annees }),
      ...(s.niveau_diplome_min ? { niveau_diplome_min: s.niveau_diplome_min } : {}),
      annees_par_secteur:
        s.secteur.trim() === "" ? [] : [{ secteur: s.secteur.trim(), annees: anneesSecteur }],
      langues: niveauLangue ? [{ langue: s.langue.trim(), niveau_min: niveauLangue }] : [],
      ...(s.reference ? { reference: s.reference } : {}),
    },
  };
}

export interface SaisieReference {
  titre: string;
  client_nom: string;
  pays: string;
  secteurs: string;
  bailleur: string;
  montant: string;
  devise: Devise;
  date_debut: string;
  date_fin: string;
  role_cabinet: string;
  description: string;
}

type ChampReference = keyof SaisieReference;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function lireReference(
  s: SaisieReference,
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, ChampReference> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampReference, string>> = {};
  if (s.titre.trim() === "")
    erreurs.titre = t("Le titre est obligatoire.", "The title is required.");
  if (s.client_nom.trim() === "") {
    erreurs.client_nom = t("Le client est obligatoire.", "The client is required.");
  }
  if (!/^[A-Za-z]{2}$/.test(s.pays.trim())) {
    erreurs.pays = t("Code pays à deux lettres (CI, SN…).", "Two-letter country code (CI, SN…).");
  }
  const montant = lireMontant(s.montant, s.devise);
  if (montant === null || Number.isNaN(montant)) {
    erreurs.montant = t("Montant du marché invalide.", "Invalid contract amount.");
  }
  if (!DATE.test(s.date_debut)) {
    erreurs.date_debut = t("Date de début obligatoire.", "The start date is required.");
  }
  if (s.date_fin !== "" && !DATE.test(s.date_fin))
    erreurs.date_fin = t("Date invalide.", "Invalid date.");
  else if (s.date_fin !== "" && s.date_fin < s.date_debut) {
    erreurs.date_fin = t("La fin précède le début.", "The end precedes the start.");
  }
  if (!(s.role_cabinet in LIBELLES_ROLE_REFERENCE)) {
    erreurs.role_cabinet = t("Choisissez le rôle.", "Choose the role.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre: s.titre.trim(),
      client_nom: s.client_nom.trim(),
      pays: s.pays.trim().toUpperCase(),
      secteurs: decouperListe(s.secteurs),
      bailleur: texteOuNull(s.bailleur),
      montant,
      devise: s.devise,
      date_debut: s.date_debut,
      date_fin: s.date_fin === "" ? null : s.date_fin,
      role_cabinet: s.role_cabinet,
      description: texteOuNull(s.description),
    },
  };
}

export interface FiltresReferences {
  q?: string;
  secteur?: string;
  pays?: string;
  bailleur?: string;
  devise?: string;
  montant_min?: string;
  montant_max?: string;
}

/** Filtres de recherche (paramètres de la page) → requête de l'API ; montants en unités usuelles. */
export function requeteReferences(f: FiltresReferences, curseur: string | null = null): string {
  const q = new URLSearchParams({ limite: "30" });
  for (const cle of ["q", "secteur", "bailleur"] as const) {
    const v = f[cle]?.trim();
    if (v) q.set(cle, v.slice(0, 100));
  }
  if (f.pays && /^[A-Za-z]{2}$/.test(f.pays.trim())) q.set("pays", f.pays.trim().toUpperCase());
  const devise = (["XOF", "XAF", "EUR", "USD"] as const).find((d) => d === f.devise);
  if (devise) {
    q.set("devise", devise);
    for (const cle of ["montant_min", "montant_max"] as const) {
      const m = f[cle] ? lireMontant(f[cle] as string, devise) : null;
      if (m !== null && !Number.isNaN(m)) q.set(cle, String(m));
    }
  }
  if (curseur) q.set("curseur", curseur);
  return `/api/banque-ao/references?${q}`;
}

/** Sections modifiées d'une offre technique ; chacune obligatoire (20 000 caractères au plus). */
export function lireSectionsOffre(
  s: SectionsOffre & { motif: string },
  langue: Langue = "fr",
): Resultat<{ sections: SectionsOffre; motif: string }, SectionOffreTechnique | "motif"> {
  const tr = creerTraduire(langue);
  const erreurs: Partial<Record<SectionOffreTechnique | "motif", string>> = {};
  const sections = {} as SectionsOffre;
  for (const cle of SECTIONS_OFFRE_TECHNIQUE) {
    const t = s[cle].trim();
    if (t === "") erreurs[cle] = tr("Cette section est obligatoire.", "This section is required.");
    else if (t.length > 20_000)
      erreurs[cle] = tr("20 000 caractères au plus.", "20,000 characters at most.");
    sections[cle] = t;
  }
  const motif = s.motif.trim();
  if (motif === "")
    erreurs.motif = tr(
      "Le motif de la modification est obligatoire.",
      "The reason for the change is required.",
    );
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { sections, motif } };
}

/**
 * Lignes d'honoraires, une par ligne : « clé | libellé | jours | taux journalier » ;
 * per diem et débours : « libellé | quantité | prix unitaire ». Montants en unités usuelles.
 */
export function lireLignesOffre(
  v: string,
  devise: Devise,
  type: "honoraires" | "quantites",
  langue: Langue = "fr",
): { ok: true; valeur: Record<string, unknown>[] } | { ok: false; erreur: string } {
  const t = creerTraduire(langue);
  const sortie: Record<string, unknown>[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const c = champs(l);
    const [cle, libelle, qte, prix] = type === "honoraires" ? c : ["", ...c];
    const quantite = lireNombre(qte ?? "");
    const montant = lireMontant(prix ?? "", devise);
    if ((type === "honoraires" && !cle) || !libelle) {
      return {
        ok: false,
        erreur: t(
          `Ligne ${i + 1} : ${type === "honoraires" ? "clé et libellé" : "libellé"} obligatoires.`,
          `Line ${i + 1}: ${type === "honoraires" ? "key and label" : "label"} required.`,
        ),
      };
    }
    if (quantite === null || Number.isNaN(quantite) || quantite < 0) {
      return {
        ok: false,
        erreur: t(
          `Ligne ${i + 1} : ${type === "honoraires" ? "jours" : "quantité"} invalide.`,
          `Line ${i + 1}: invalid ${type === "honoraires" ? "days" : "quantity"}.`,
        ),
      };
    }
    if (montant === null || Number.isNaN(montant)) {
      return {
        ok: false,
        erreur: t(`Ligne ${i + 1} : montant invalide.`, `Line ${i + 1}: invalid amount.`),
      };
    }
    sortie.push(
      type === "honoraires"
        ? { cle, libelle, jours: quantite, taux_journalier: montant }
        : { libelle, quantite, prix_unitaire: montant },
    );
  }
  return { ok: true, valeur: sortie };
}

export interface SaisieOffreFinanciere {
  titre: string;
  devise: Devise;
  honoraires: string;
  per_diem: string;
  debours: string;
  tva: string;
}

type ChampOffreFinanciere = keyof SaisieOffreFinanciere;

export function lireOffreFinanciere(
  s: SaisieOffreFinanciere,
  langue: Langue = "fr",
): Resultat<{ titre: string; entree: Record<string, unknown> }, ChampOffreFinanciere> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampOffreFinanciere, string>> = {};
  if (s.titre.trim() === "")
    erreurs.titre = t("Le titre est obligatoire.", "The title is required.");
  const hon = lireLignesOffre(s.honoraires, s.devise, "honoraires", langue);
  if (!hon.ok) erreurs.honoraires = hon.erreur;
  const pd = lireLignesOffre(s.per_diem, s.devise, "quantites", langue);
  if (!pd.ok) erreurs.per_diem = pd.erreur;
  const deb = lireLignesOffre(s.debours, s.devise, "quantites", langue);
  if (!deb.ok) erreurs.debours = deb.erreur;
  const tva = lireNombre(s.tva);
  if (tva !== null && (Number.isNaN(tva) || tva < 0 || tva > 100)) {
    erreurs.tva = t("Taux de 0 à 100.", "Rate from 0 to 100.");
  }
  if (Object.keys(erreurs).length > 0 || !hon.ok || !pd.ok || !deb.ok)
    return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre: s.titre.trim(),
      entree: {
        devise: s.devise,
        honoraires: hon.valeur,
        per_diem: pd.valeur,
        debours: deb.valeur,
        taxes:
          tva === null || tva === 0 ? [] : [{ libelle: "TVA", taux: tva, assiette: "total_ht" }],
      },
    },
  };
}

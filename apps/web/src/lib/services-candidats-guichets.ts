/** Services candidats : saisie et validation des guichets (module extrait de `services-candidats.ts`). */
import { NBSP, estDevise, lireEntier } from "./services-candidats-outils";
import { SYMBOLES_DEVISE, montantVersTexte } from "./services-candidats-libelles";
import type { Guichet } from "./services-candidats-types";
import {
  OBJETS_FINANCEMENT,
  TYPES_GUICHET,
  type ObjetFinancement,
  type TypeGuichet,
} from "@missionpilot/shared";
import { formaterNombre, type Devise } from "./format";
import { decouperListe, joindreListe, texteOuNull, type Resultat } from "./saisie";

export interface SaisieGuichet {
  nom: string;
  type: string;
  pays: string;
  secteurs: string;
  filieres: string;
  tailles: string;
  objets: string[];
  devises: string[];
  montant_min: string;
  montant_max: string;
  devise_montant: string;
  date_limite: string;
  description: string;
  url: string;
  actif: boolean;
}
export type ChampGuichet = keyof SaisieGuichet;

export const SAISIE_GUICHET_VIDE: SaisieGuichet = {
  nom: "",
  type: "",
  pays: "",
  secteurs: "",
  filieres: "",
  tailles: "",
  objets: [],
  devises: [],
  montant_min: "",
  montant_max: "",
  devise_montant: "",
  date_limite: "",
  description: "",
  url: "",
  actif: true,
};

export function saisieDepuisGuichet(g: Guichet): SaisieGuichet {
  return {
    nom: g.nom,
    type: g.type,
    pays: joindreListe(g.pays),
    secteurs: joindreListe(g.secteurs),
    filieres: joindreListe(g.filieres),
    tailles: joindreListe(g.tailles),
    objets: [...g.objets],
    devises: [...g.devises],
    montant_min: montantVersTexte(g.montant_min),
    montant_max: montantVersTexte(g.montant_max),
    devise_montant: g.devise_montant ?? "",
    date_limite: g.date_limite ?? "",
    description: g.description ?? "",
    url: g.url ?? "",
    actif: g.actif,
  };
}

export interface ChargeGuichet {
  nom: string;
  type: TypeGuichet;
  pays: string[];
  secteurs: string[];
  filieres: string[];
  tailles: string[];
  objets: ObjetFinancement[];
  devises: Devise[];
  montant_min: number | null;
  montant_max: number | null;
  devise_montant: Devise | null;
  date_limite: string | null;
  description: string | null;
  url: string | null;
  actif: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mêmes bornes que le schéma partagé : entrées, longueur d'une entrée, total (jointes par « , »). */
function lireListe(
  v: string,
  champ: ChampGuichet,
  erreurs: Partial<Record<ChampGuichet, string>>,
  maxEntrees: number,
  maxCaracteres: number,
) {
  const liste = decouperListe(v);
  if (liste.length > maxEntrees || liste.some((e) => e.length > 80))
    erreurs[champ] = `${maxEntrees} éléments de 80 caractères au plus.`;
  else if (liste.join(",").length > maxCaracteres)
    erreurs[champ] = `${maxCaracteres} caractères au plus en tout.`;
  return liste;
}

const CARACTERE_DE_CONTROLE = /\p{Cc}/u;
const ADRESSE_HTTP = /^https?:\/\/[^\s]+$/i;

/** Corps complet de création (POST) ou de modification (PATCH) d'un guichet. */
export function validerGuichet(s: SaisieGuichet): Resultat<ChargeGuichet, ChampGuichet> {
  const erreurs: Partial<Record<ChampGuichet, string>> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du guichet.";
  else if (nom.length > 200) erreurs.nom = "200 caractères au plus.";
  else if (CARACTERE_DE_CONTROLE.test(nom))
    erreurs.nom = "Le nom ne doit pas contenir de caractère de contrôle.";
  if (!(TYPES_GUICHET as readonly string[]).includes(s.type))
    erreurs.type = "Choisissez un type de guichet.";
  const pays = lireListe(s.pays, "pays", erreurs, 60, 600);
  const secteurs = lireListe(s.secteurs, "secteurs", erreurs, 50, 2000);
  const filieres = lireListe(s.filieres, "filieres", erreurs, 50, 2000);
  const tailles = lireListe(s.tailles, "tailles", erreurs, 10, 200);
  const objets = [...new Set(s.objets)] as ObjetFinancement[];
  if (
    objets.length > 10 ||
    objets.some((o) => !(OBJETS_FINANCEMENT as readonly string[]).includes(o))
  )
    erreurs.objets = "10 objets de financement valides au plus.";
  const devises = [...new Set(s.devises)] as Devise[];
  if (devises.length > 4 || devises.some((d) => !estDevise(d)))
    erreurs.devises = "4 devises valides au plus.";
  const min = lireEntier(s.montant_min);
  const max = lireEntier(s.montant_max);
  if (min !== null && Number.isNaN(min)) erreurs.montant_min = "Montant entier positif attendu.";
  if (max !== null && Number.isNaN(max)) erreurs.montant_max = "Montant entier positif attendu.";
  if (!erreurs.montant_min && !erreurs.montant_max && min !== null && max !== null && min > max)
    erreurs.montant_min = "Le montant minimum ne peut pas dépasser le maximum.";
  const borne = (min !== null && !Number.isNaN(min)) || (max !== null && !Number.isNaN(max));
  if (s.devise_montant !== "" && !estDevise(s.devise_montant))
    erreurs.devise_montant = "Choisissez une devise.";
  else if (borne && s.devise_montant === "")
    erreurs.devise_montant = "La devise du montant est obligatoire quand une borne est donnée.";
  if (s.date_limite !== "" && !DATE.test(s.date_limite)) erreurs.date_limite = "Date invalide.";
  const description = texteOuNull(s.description);
  if (description && description.length > 2000) erreurs.description = "2 000 caractères au plus.";
  const url = texteOuNull(s.url);
  if (url) {
    let ok = url.length <= 500 && ADRESSE_HTTP.test(url);
    try {
      const { protocol } = new URL(url);
      ok = ok && (protocol === "http:" || protocol === "https:");
    } catch {
      ok = false;
    }
    if (!ok) erreurs.url = "Adresse http ou https attendue, sans espace (500 caractères au plus).";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      nom,
      type: s.type as TypeGuichet,
      pays,
      secteurs,
      filieres,
      tailles,
      objets,
      devises,
      montant_min: min,
      montant_max: max,
      devise_montant: s.devise_montant === "" ? null : (s.devise_montant as Devise),
      date_limite: s.date_limite === "" ? null : s.date_limite,
      description,
      url,
      actif: s.actif,
    },
  };
}

/** Liste de restrictions d'un guichet ; une liste vide signifie « aucune restriction ». */
export function joindreRestrictions(liste: readonly string[]): string {
  return liste.length === 0 ? "Aucune restriction" : liste.join(", ");
}

/** « 5 000 000 – 50 000 000 FCFA », « À partir de … », « Jusqu'à … » ou « Non borné ». */
export function formaterBornesGuichet(
  g: Pick<Guichet, "montant_min" | "montant_max" | "devise_montant">,
): string {
  const symbole = g.devise_montant ? SYMBOLES_DEVISE[g.devise_montant] : "";
  const suffixe = symbole ? `${NBSP}${symbole}` : "";
  const { montant_min: min, montant_max: max } = g;
  if (min !== null && max !== null)
    return `${formaterNombre(min, 0)} – ${formaterNombre(max, 0)}${suffixe}`;
  if (min !== null) return `À partir de ${formaterNombre(min, 0)}${suffixe}`;
  if (max !== null) return `Jusqu'à ${formaterNombre(max, 0)}${suffixe}`;
  return "Non borné";
}

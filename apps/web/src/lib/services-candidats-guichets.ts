/** Services candidats : saisie et validation des guichets (module extrait de `services-candidats.ts`). */
import { NBSP, estDevise, lireEntier } from "./services-candidats-outils";
import { SYMBOLES_DEVISE, montantVersTexte } from "./services-candidats-libelles";
import type { Guichet } from "./services-candidats-types";
import {
  OBJETS_FINANCEMENT,
  TYPES_GUICHET,
  creerTraduire,
  type Langue,
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
  langue: Langue = "fr",
) {
  const t = creerTraduire(langue);
  const liste = decouperListe(v);
  if (liste.length > maxEntrees || liste.some((e) => e.length > 80))
    erreurs[champ] = t(
      `${maxEntrees} éléments de 80 caractères au plus.`,
      `${maxEntrees} items of 80 characters at most.`,
    );
  else if (liste.join(",").length > maxCaracteres)
    erreurs[champ] = t(
      `${maxCaracteres} caractères au plus en tout.`,
      `${maxCaracteres} characters at most in total.`,
    );
  return liste;
}

const CARACTERE_DE_CONTROLE = /\p{Cc}/u;
const ADRESSE_HTTP = /^https?:\/\/[^\s]+$/i;

/** Corps complet de création (POST) ou de modification (PATCH) d'un guichet. */
export function validerGuichet(
  s: SaisieGuichet,
  langue: Langue = "fr",
): Resultat<ChargeGuichet, ChampGuichet> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampGuichet, string>> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = t("Saisissez le nom du guichet.", "Enter the funding source name.");
  else if (nom.length > 200) erreurs.nom = t("200 caractères au plus.", "200 characters at most.");
  else if (CARACTERE_DE_CONTROLE.test(nom))
    erreurs.nom = t(
      "Le nom ne doit pas contenir de caractère de contrôle.",
      "The name must not contain control characters.",
    );
  if (!(TYPES_GUICHET as readonly string[]).includes(s.type))
    erreurs.type = t("Choisissez un type de guichet.", "Choose a funding source type.");
  const pays = lireListe(s.pays, "pays", erreurs, 60, 600, langue);
  const secteurs = lireListe(s.secteurs, "secteurs", erreurs, 50, 2000, langue);
  const filieres = lireListe(s.filieres, "filieres", erreurs, 50, 2000, langue);
  const tailles = lireListe(s.tailles, "tailles", erreurs, 10, 200, langue);
  const objets = [...new Set(s.objets)] as ObjetFinancement[];
  if (
    objets.length > 10 ||
    objets.some((o) => !(OBJETS_FINANCEMENT as readonly string[]).includes(o))
  )
    erreurs.objets = t(
      "10 objets de financement valides au plus.",
      "10 valid financing purposes at most.",
    );
  const devises = [...new Set(s.devises)] as Devise[];
  if (devises.length > 4 || devises.some((d) => !estDevise(d)))
    erreurs.devises = t("4 devises valides au plus.", "4 valid currencies at most.");
  const min = lireEntier(s.montant_min);
  const max = lireEntier(s.montant_max);
  const montantAttendu = t("Montant entier positif attendu.", "Positive whole amount expected.");
  if (min !== null && Number.isNaN(min)) erreurs.montant_min = montantAttendu;
  if (max !== null && Number.isNaN(max)) erreurs.montant_max = montantAttendu;
  if (!erreurs.montant_min && !erreurs.montant_max && min !== null && max !== null && min > max)
    erreurs.montant_min = t(
      "Le montant minimum ne peut pas dépasser le maximum.",
      "The minimum amount cannot exceed the maximum.",
    );
  const borne = (min !== null && !Number.isNaN(min)) || (max !== null && !Number.isNaN(max));
  if (s.devise_montant !== "" && !estDevise(s.devise_montant))
    erreurs.devise_montant = t("Choisissez une devise.", "Choose a currency.");
  else if (borne && s.devise_montant === "")
    erreurs.devise_montant = t(
      "La devise du montant est obligatoire quand une borne est donnée.",
      "The amount currency is required when a bound is given.",
    );
  if (s.date_limite !== "" && !DATE.test(s.date_limite))
    erreurs.date_limite = t("Date invalide.", "Invalid date.");
  const description = texteOuNull(s.description);
  if (description && description.length > 2000)
    erreurs.description = t("2 000 caractères au plus.", "2,000 characters at most.");
  const url = texteOuNull(s.url);
  if (url) {
    let ok = url.length <= 500 && ADRESSE_HTTP.test(url);
    try {
      const { protocol } = new URL(url);
      ok = ok && (protocol === "http:" || protocol === "https:");
    } catch {
      ok = false;
    }
    if (!ok)
      erreurs.url = t(
        "Adresse http ou https attendue, sans espace (500 caractères au plus).",
        "An http or https address is expected, without spaces (500 characters at most).",
      );
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
export function joindreRestrictions(liste: readonly string[], langue: Langue = "fr"): string {
  return liste.length === 0
    ? creerTraduire(langue)("Aucune restriction", "No restrictions")
    : liste.join(", ");
}

/** « 5 000 000 – 50 000 000 FCFA », « À partir de … », « Jusqu'à … » ou « Non borné ». */
export function formaterBornesGuichet(
  g: Pick<Guichet, "montant_min" | "montant_max" | "devise_montant">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const symbole = g.devise_montant ? SYMBOLES_DEVISE[g.devise_montant] : "";
  const suffixe = symbole ? `${NBSP}${symbole}` : "";
  const { montant_min: min, montant_max: max } = g;
  if (min !== null && max !== null)
    return `${formaterNombre(min, 0, langue)} – ${formaterNombre(max, 0, langue)}${suffixe}`;
  if (min !== null)
    return `${t("À partir de ", "From ")}${formaterNombre(min, 0, langue)}${suffixe}`;
  if (max !== null) return `${t("Jusqu'à ", "Up to ")}${formaterNombre(max, 0, langue)}${suffixe}`;
  return t("Non borné", "Unbounded");
}

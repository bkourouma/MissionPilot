/** Notation augmentée : banque d'items (NOT-09) (voir `notation-augmentee.ts`). */
import { entier, FORMAT_IDENTIFIANT } from "./notation-augmentee-commun";
import {
  aPermission,
  PUBLICS_ITEM_NOTATION,
  type ItemBanqueDonnees,
  type PublicItemNotation,
  type Role,
} from "@missionpilot/shared";
import { estExpertPublieur, type TonaliteNotation } from "./notation";
import { lireNombre, type Resultat } from "./saisie";

const segment = encodeURIComponent;

/* =====================================================================================
 * NOT-09 : rédaction, validation et lecture d'un item de la banque
 * Les contrôles de ce module sont un CONFORT (messages avant l'envoi) : le schéma partagé et le
 * moteur de l'API restent seuls juges, et leurs refus sont affichés en français.
 * ===================================================================================== */

export const INTITULE_LONGUEUR_MAX = 200;
export const LIBELLE_NIVEAU_LONGUEUR_MAX = 120;
/** Miroir de `FORMULATION_LONGUEUR_MAX` et `ANCRAGE_LONGUEUR_MAX` du moteur. */
export const FORMULATION_LONGUEUR_MAX = 500;
export const ANCRAGE_LONGUEUR_MAX = 1000;
/** Les ancrages réunis (« 1 : … ; 2 : … ») forment l'aide d'une question : 1000 caractères. */
export const AIDE_ANCRAGES_LONGUEUR_MAX = 1000;
export const NIVEAUX_ITEM_MIN = 2;
export const NIVEAUX_ITEM_MAX = 10;
export const PRIORITE_ITEM_MAX = 9;
export const DUREE_ITEM_MIN_SECONDES = 5;
export const DUREE_ITEM_MAX_SECONDES = 600;
export const POIDS_ITEM_MAX = 100;

export const MESSAGE_IDENTIFIANT =
  "Identifiant : minuscules sans accent, chiffres, « _ », « . » ou « - », 80 caractères au plus, en commençant par une lettre ou un chiffre.";

export interface VersionItemBanque {
  id: string;
  version: number;
  statut: "brouillon" | "valide";
  cree_le: string;
  valide_le: string | null;
}

/** Réponse de `GET /api/notation/banque/:id` (et des écritures sur un item). */
export interface ItemBanqueDetail {
  id: string;
  code: string;
  version: number;
  dimension: string;
  pratique: string;
  statut: "brouillon" | "valide";
  contenu: ItemBanqueDonnees;
  cree_par: string;
  cree_le: string;
  modifie_par: string;
  modifie_le: string;
  valide_par: string | null;
  valide_le: string | null;
  versions: VersionItemBanque[];
}

export const CHEMIN_BANQUE = "/api/notation/banque";
export const cheminItemBanque = (id: string) => `${CHEMIN_BANQUE}/${segment(id)}`;
export const cheminValiderItem = (id: string) => `${cheminItemBanque(id)}/valider`;
export const hrefItemBanque = (id: string) => `/notation/banque/${segment(id)}`;
export const HREF_NOUVEL_ITEM = "/notation/banque/nouveau";
/** Nouvelle version (brouillon) d'un item validé, préremplie depuis la version `id`. */
export const hrefNouvelleVersionItem = (id: string) => `${HREF_NOUVEL_ITEM}?depuis=${segment(id)}`;

export const STATUTS_ITEM: Record<
  ItemBanqueDetail["statut"],
  { libelle: string; tonalite: TonaliteNotation }
> = {
  brouillon: { libelle: "Brouillon", tonalite: "neutre" },
  valide: { libelle: "Validé", tonalite: "succes" },
};

/** Compteur affiché sous un champ à longueur limitée (« 120 / 500 caractères »). */
export const compteurCaracteres = (saisie: string, max: number) =>
  `${saisie.trim().length} / ${max} caractères`;

/** Texte d'aide d'une question : ancrages par niveau croissant, comme le moteur les réunit. */
export function aideDepuisAncrages(
  ancrages: readonly { niveau: number; comportement: string }[],
): string {
  return [...ancrages]
    .sort((a, b) => a.niveau - b.niveau)
    .map((a) => `${a.niveau} : ${a.comportement}`)
    .join(" ; ");
}

/** Saisie d'un item : tout en texte, tableaux de 10 cases (seuls les `niveaux` premiers servent). */
export interface SaisieItemBanque {
  code: string;
  dimension: string;
  pratique: string;
  intitule: string;
  niveaux: string;
  libelles: string[];
  ancrages: string[];
  formulations: Record<PublicItemNotation, string>;
  poids: string;
  priorite: string;
  duree: string;
}

const completer = (liste: readonly string[]): string[] =>
  Array.from({ length: NIVEAUX_ITEM_MAX }, (_, i) => liste[i] ?? "");

const formulationsVides = (): Record<PublicItemNotation, string> => ({
  tous: "",
  dirigeant: "",
  manager: "",
  equipe: "",
  externe: "",
});

/** Saisie d'un nouvel item : échelle à 5 niveaux, valeurs par défaut modifiables. */
export function saisieItemVide(): SaisieItemBanque {
  return {
    code: "",
    dimension: "",
    pratique: "",
    intitule: "",
    niveaux: "5",
    libelles: completer([]),
    ancrages: completer([]),
    formulations: formulationsVides(),
    poids: "1",
    priorite: "5",
    duree: "30",
  };
}

/** Saisie préremplie depuis un contenu enregistré (édition d'un brouillon, nouvelle version). */
export function saisieDepuisItem(c: ItemBanqueDonnees): SaisieItemBanque {
  const formulations = formulationsVides();
  for (const f of c.formulations) formulations[f.public] = f.texte;
  const n = c.echelle.niveaux;
  return {
    code: c.code,
    dimension: c.dimension,
    pratique: c.pratique,
    intitule: c.intitule,
    niveaux: String(n),
    libelles: completer(c.echelle.libelles),
    ancrages: completer(
      Array.from(
        { length: n },
        (_, i) => c.ancrages.find((a) => a.niveau === i + 1)?.comportement ?? "",
      ),
    ),
    formulations,
    poids: String(c.poids).replace(".", ","),
    priorite: String(c.priorite),
    duree: String(c.dureeSecondes),
  };
}

/**
 * Contrôle d'une saisie d'item avant l'envoi. Clés d'erreur : `code`, `dimension`, `pratique`,
 * `intitule`, `niveaux`, `libelle-N`, `ancrage-N` (N = niveau), `ancrages`, `formulations`,
 * `formulation-PUBLIC`, `poids`, `priorite`, `duree`. `base` (contenu enregistré) conserve ce que le
 * formulaire n'édite pas : exemples par contexte des ancrages et étalonnage.
 */
export function validerSaisieItem(
  s: SaisieItemBanque,
  base: ItemBanqueDonnees | null = null,
): Resultat<{ contenu: ItemBanqueDonnees }, string> {
  const e: Record<string, string> = {};
  const code = s.code.trim();
  const dimension = s.dimension.trim();
  const pratique = s.pratique.trim();
  for (const [cle, v] of [
    ["code", code],
    ["dimension", dimension],
    ["pratique", pratique],
  ] as const) {
    if (!FORMAT_IDENTIFIANT.test(v)) e[cle] = MESSAGE_IDENTIFIANT;
  }
  const intitule = s.intitule.trim();
  if (intitule === "") e.intitule = "L'intitulé de la pratique évaluée est obligatoire.";
  else if (intitule.length > INTITULE_LONGUEUR_MAX) {
    e.intitule = `Intitulé de ${INTITULE_LONGUEUR_MAX} caractères au plus.`;
  }

  const niveaux = entier(s.niveaux);
  const nombre =
    niveaux !== null && niveaux >= NIVEAUX_ITEM_MIN && niveaux <= NIVEAUX_ITEM_MAX ? niveaux : 0;
  if (nombre === 0) {
    e.niveaux = `Nombre de niveaux : entier de ${NIVEAUX_ITEM_MIN} à ${NIVEAUX_ITEM_MAX}.`;
  }
  const libelles: string[] = [];
  const comportements: string[] = [];
  for (let i = 0; i < nombre; i++) {
    const rang = i + 1;
    const libelle = (s.libelles[i] ?? "").trim();
    if (libelle === "") e[`libelle-${rang}`] = "Libellé du niveau obligatoire.";
    else if (libelle.length > LIBELLE_NIVEAU_LONGUEUR_MAX) {
      e[`libelle-${rang}`] = `Libellé de ${LIBELLE_NIVEAU_LONGUEUR_MAX} caractères au plus.`;
    }
    libelles.push(libelle);
    const comportement = (s.ancrages[i] ?? "").trim();
    if (comportement === "") {
      e[`ancrage-${rang}`] = "Un comportement observable est obligatoire pour chaque niveau.";
    } else if (comportement.length > ANCRAGE_LONGUEUR_MAX) {
      e[`ancrage-${rang}`] = `Comportement de ${ANCRAGE_LONGUEUR_MAX} caractères au plus.`;
    }
    comportements.push(comportement);
  }
  if (nombre > 0 && !Object.keys(e).some((k) => k.startsWith("ancrage-"))) {
    const reuni = aideDepuisAncrages(
      comportements.map((comportement, i) => ({ niveau: i + 1, comportement })),
    ).length;
    if (reuni > AIDE_ANCRAGES_LONGUEUR_MAX) {
      e.ancrages = `Ancrages trop longs : ${AIDE_ANCRAGES_LONGUEUR_MAX} caractères au plus une fois réunis (« niveau : comportement »), ${reuni} saisis.`;
    }
  }

  const formulations: { public: PublicItemNotation; texte: string }[] = [];
  for (const p of PUBLICS_ITEM_NOTATION) {
    const texte = s.formulations[p].trim();
    if (texte === "") continue;
    if (texte.length > FORMULATION_LONGUEUR_MAX) {
      e[`formulation-${p}`] = `Formulation de ${FORMULATION_LONGUEUR_MAX} caractères au plus.`;
    }
    formulations.push({ public: p, texte });
  }
  if (formulations.length === 0) {
    e.formulations = "Au moins une formulation est obligatoire (idéalement « Tous publics »).";
  }

  const poids = lireNombre(s.poids);
  if (poids === null || Number.isNaN(poids) || poids <= 0 || poids > POIDS_ITEM_MAX) {
    e.poids = `Poids : nombre supérieur à 0 et au plus ${POIDS_ITEM_MAX}.`;
  }
  const priorite = entier(s.priorite);
  if (priorite === null || priorite < 1 || priorite > PRIORITE_ITEM_MAX) {
    e.priorite = `Priorité : entier de 1 (cœur de la dimension) à ${PRIORITE_ITEM_MAX}.`;
  }
  const duree = entier(s.duree);
  if (duree === null || duree < DUREE_ITEM_MIN_SECONDES || duree > DUREE_ITEM_MAX_SECONDES) {
    e.duree = `Durée de réponse : entier de ${DUREE_ITEM_MIN_SECONDES} à ${DUREE_ITEM_MAX_SECONDES} secondes.`;
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };

  const contenu: ItemBanqueDonnees = {
    code,
    dimension,
    pratique,
    intitule,
    echelle: { niveaux: nombre, libelles },
    ancrages: comportements.map((comportement, i) => {
      const exemples = base?.ancrages.find((a) => a.niveau === i + 1)?.exemples;
      return {
        niveau: i + 1,
        comportement,
        ...(exemples && exemples.length > 0 ? { exemples } : {}),
      };
    }),
    formulations,
    poids: poids as number,
    priorite: priorite as number,
    dureeSecondes: duree as number,
    ...(base?.etalonnage ? { etalonnage: base.etalonnage } : {}),
  };
  return { ok: true, charge: { contenu } };
}

export interface DroitsItemBanque {
  /** Brouillon modifiable par qui rédige (notation.gerer ou notation.publier). */
  modifier: boolean;
  /** Une version validée est figée : une correction passe par une nouvelle version. */
  nouvelleVersion: boolean;
  /** Le bouton « Valider » n'existe que pour `notation.publier`. */
  validerVisible: boolean;
  /** Bouton actif : expert métier qui n'est ni l'auteur ni le dernier modificateur. */
  valider: boolean;
  /** Pourquoi la validation est impossible (brouillon seulement), `null` si elle est possible. */
  explicationValidation: string | null;
}

/** Droits d'AFFICHAGE sur une version d'item ; l'API reste seule juge (MPN04, MPN08). */
export function droitsItemBanque(
  roles: readonly Role[],
  utilisateurId: string,
  item: { statut: "brouillon" | "valide"; cree_par: string; modifie_par: string },
): DroitsItemBanque {
  const brouillon = item.statut === "brouillon";
  const redige = aPermission(roles, "notation.gerer") || aPermission(roles, "notation.publier");
  const validerVisible = brouillon && aPermission(roles, "notation.publier");
  const auteur = item.cree_par === utilisateurId || item.modifie_par === utilisateurId;
  let explicationValidation: string | null = null;
  if (brouillon && !estExpertPublieur(roles)) {
    explicationValidation =
      "La validation d'un item revient à un expert métier du cabinet : votre rôle permet de le rédiger, pas de le valider.";
  } else if (brouillon && auteur) {
    explicationValidation =
      "Vous avez rédigé ou modifié ce brouillon : un autre expert métier doit le relire et le valider (séparation des tâches).";
  }
  return {
    modifier: brouillon && redige,
    nouvelleVersion: !brouillon && redige,
    validerVisible,
    valider: validerVisible && explicationValidation === null,
    explicationValidation,
  };
}

import { libelleDimensionDd } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterNombre, VALEUR_ABSENTE } from "./format";
import { FIABILITES, TYPE_SOURCE_LIBELLES } from "./preuves-libelles";
import type {
  CarteTriangulationVue,
  DimensionVue,
  FiabiliteApi,
  SoliditeVue,
} from "./preuves-types";

// --- Mise en forme --------------------------------------------------------------------------

/** Indice de 0 à 1 déjà arrondi par le moteur : « 0,875 », « 1 », « 0,4375 ». */
export function formaterIndice(indice: number | null | undefined): string {
  return formaterNombre(indice, 4);
}

/** Poids ou somme reçus en centièmes → « 0,75 » (affichage seulement). */
export function formaterCentiemes(centiemes: number | null | undefined): string {
  if (typeof centiemes !== "number" || !Number.isFinite(centiemes)) return VALEUR_ABSENTE;
  return formaterNombre(centiemes / 100, 2);
}

/** Seuil reçu en dix-millièmes → « 0,75 » (affichage seulement). */
export function formaterSeuil(dixMillieme: number): string {
  return formaterNombre(dixMillieme / 10_000, 4);
}

export function libelleFiabilite(f: FiabiliteApi): string {
  return FIABILITES[f];
}

/** Dimension d'une preuve : libellé déclaré pour la mission, sinon libellé « dd.* » connu, sinon le code. */
export function libelleDimension(
  code: string,
  dimensions: readonly Pick<DimensionVue, "code" | "libelle">[],
): string {
  return dimensions.find((d) => d.code === code)?.libelle ?? libelleDimensionDd(code) ?? code;
}

/**
 * Explication en phrases de l'indice de solidité, à partir des nombres du moteur. Une ligne par
 * élément (source retenue, plafond, contradiction, seuils) ; aucun chiffre n'est calculé ici.
 */
export function expliquerSolidite(s: SoliditeVue): string[] {
  const lignes: string[] = [];
  if (s.fiabilites_retenues.length === 0) {
    lignes.push("Aucune preuve en faveur de l'assertion : l'indice est nul.");
  } else {
    lignes.push(
      "Pour chaque type de source indépendant, on retient la meilleure fiabilité : " +
        s.fiabilites_retenues
          .map(
            (f) =>
              `${TYPE_SOURCE_LIBELLES[f.type_source].toLowerCase()} (${f.fiabilite}, ${formaterCentiemes(f.poids_centiemes)})`,
          )
          .join(", ") +
        ".",
    );
    lignes.push(
      s.plafonnee
        ? `Somme ${formaterCentiemes(s.somme_centiemes)}, plafonnée à ${formaterCentiemes(s.plafond_centiemes)}.`
        : `Somme ${formaterCentiemes(s.somme_centiemes)} (plafond ${formaterCentiemes(s.plafond_centiemes)}).`,
    );
  }
  if (s.contradiction_non_resolue) {
    lignes.push(
      "Une contradiction n'est pas arbitrée : l'indice est divisé par deux tant que le consultant ne l'a pas tranchée.",
    );
  } else if (s.preuves_contre > 0) {
    lignes.push("Les preuves contraires ont été arbitrées par le consultant.");
  }
  lignes.push(
    `Indice : ${formaterCentiemes(s.numerateur)} sur ${formaterCentiemes(s.denominateur)}, soit ${formaterIndice(s.indice)}.`,
  );
  lignes.push(
    `Lecture : solide à partir de ${formaterSeuil(s.seuil_solide)}, étayée à partir de ${formaterSeuil(s.seuil_etayee)}, fragile en dessous.`,
  );
  return lignes;
}

/** Cellules de la carte en lignes (dimension) × colonnes (types de source), ordre de l'API. */
export function matriceTriangulation(carte: CarteTriangulationVue) {
  const types = [...new Set(carte.cellules.map((c) => c.type_source))];
  const zones = new Set(carte.zones_non_couvertes.map((z) => `${z.dimension}/${z.type_source}`));
  return {
    types,
    lignes: carte.dimensions.map((d) => ({
      ...d,
      cellules: types.map((t) => {
        const c = carte.cellules.find((x) => x.dimension === d.code && x.type_source === t);
        return {
          type_source: t,
          preuves: c?.preuves ?? 0,
          meilleure_fiabilite: c?.meilleure_fiabilite ?? null,
          non_couverte: zones.has(`${d.code}/${t}`),
        };
      }),
    })),
  };
}

/** État de couverture d'une dimension, en texte (la couleur ne porte jamais seule le sens). */
export function etatDimension(d: { couverte: boolean; triangulee: boolean }): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  if (!d.couverte) return { libelle: "Non couverte", tonalite: "danger" };
  if (!d.triangulee) return { libelle: "Une seule source", tonalite: "attention" };
  return { libelle: "Triangulée", tonalite: "succes" };
}

export function libelleAuteur(auteur: { nom: string | null } | null | undefined): string {
  return auteur?.nom ?? "Utilisateur supprimé";
}

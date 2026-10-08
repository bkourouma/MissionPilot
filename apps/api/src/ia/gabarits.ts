import type {
  ChampSortie,
  ChiffreContexte,
  SchemaSortie,
  TacheGenerative,
} from "@missionpilot/shared";
import type { SortieValidee } from "./prompts.js";

/*
 * Repli DÉTERMINISTE (ADR-003) : sans clé API, IA désactivée par le cabinet
 * ou plafond mensuel atteint (avec `repli_si_plafond`), chaque tâche produit
 * un contenu fabriqué PAR CODE à partir des seules entrées fournies, marqué
 * `gabarit: true` et soumis à la même validation humaine qu'un brouillon IA.
 *
 * - Texte : en-tête explicite, chiffres des moteurs mis en forme (« libellé :
 *   valeur unité »), premières phrases du texte fourni (extrait, jamais une
 *   reformulation) et invitation à compléter.
 * - Objet : champs texte à compléter, listes vides, booléens à faux, choix
 *   par mots-clés présents dans le texte (sinon la valeur par défaut).
 * Aucun nombre n'est créé : seuls ceux des entrées sont repris (la
 * garde-chiffres s'applique ensuite comme pour un modèle).
 */

export interface EntreeGabarit {
  tache: TacheGenerative;
  schema: SchemaSortie;
  variables: Readonly<Record<string, string>>;
  chiffres: readonly ChiffreContexte[];
}

export const ENTETE_GABARIT =
  "Contenu produit par gabarit déterministe (IA indisponible ou désactivée) : " +
  "à compléter et vérifier par le consultant.";

const ESPACE_FINE = "\u202f";

/** Valeur d'un chiffre en écriture française, sans arrondi (« 1 500 000 », « 12,5 »). */
export function formaterNombre(valeur: number): string {
  const [entier = "0", decimales] = String(Math.abs(valeur)).split(".");
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_FINE);
  return `${valeur < 0 ? "-" : ""}${groupe}${decimales ? `,${decimales}` : ""}`;
}

/** Ligne « libellé : valeur unité » d'un chiffre fourni par un moteur. */
export function ligneChiffre(c: ChiffreContexte): string {
  const unite = c.unite ? (c.unite === "%" ? `${ESPACE_FINE}%` : ` ${c.unite}`) : "";
  return `- ${c.libelle} : ${formaterNombre(c.valeur)}${unite}`;
}

/** Bloc des chiffres fournis (variable réservée « chiffres »). */
export function blocChiffres(chiffres: readonly ChiffreContexte[]): string {
  return chiffres.length === 0 ? "(aucun chiffre fourni)" : chiffres.map(ligneChiffre).join("\n");
}

/** Premières phrases d'un texte (extrait), 600 caractères au plus. */
export function premieresPhrases(texte: string, n = 3): string {
  const phrases = texte
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((p) => p.length > 0)
    .slice(0, n)
    .join(" ");
  return phrases.length > 600 ? `${phrases.slice(0, 597)}...` : phrases;
}

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Choix par mots-clés : valeur la plus citée dans le texte, sinon le défaut (ou la première). */
export function choixParMotsCles(
  champ: Extract<ChampSortie, { type: "choix" }>,
  texte: string,
): string {
  const t = sansAccents(texte);
  let meilleur: { valeur: string; n: number } | null = null;
  for (const valeur of champ.valeurs) {
    const mot = sansAccents(valeur.replace(/_/g, " "));
    const n = t.split(mot).length - 1;
    if (n > 0 && (!meilleur || n > meilleur.n)) meilleur = { valeur, n };
  }
  return meilleur?.valeur ?? champ.defaut ?? (champ.valeurs[0] as string);
}

/** Contenu déterministe d'une tâche : même entrée → même sortie. */
export function produireGabarit(e: EntreeGabarit): SortieValidee {
  const texteFourni = Object.values(e.variables).join("\n");
  if (e.schema.type === "texte") {
    const morceaux = [ENTETE_GABARIT];
    if (e.chiffres.length > 0) {
      morceaux.push(`Chiffres calculés par les moteurs :\n${blocChiffres(e.chiffres)}`);
    }
    const source = e.variables.texte ?? texteFourni;
    const extrait = premieresPhrases(source);
    if (extrait) morceaux.push(`Extrait du texte fourni :\n${extrait}`);
    return { texte: morceaux.join("\n\n"), donnees: null };
  }
  const donnees: Record<string, unknown> = {};
  for (const [nom, champ] of Object.entries(e.schema.champs)) {
    switch (champ.type) {
      case "texte":
        donnees[nom] = `${ENTETE_GABARIT}`.slice(0, champ.longueur_max ?? 5000);
        break;
      case "liste_texte":
        donnees[nom] = [];
        break;
      case "booleen":
        donnees[nom] = false;
        break;
      case "choix":
        donnees[nom] = choixParMotsCles(champ, texteFourni);
        break;
    }
  }
  return { texte: JSON.stringify(donnees, null, 2), donnees };
}

/**
 * Redressement : secteur proposé à l'ouverture d'un dossier, d'après le secteur libre du CLIENT
 * de la mission. Fonction pure, testée dans `redressement-secteur.test.ts`.
 *
 * HYPOTHÈSE MÉTIER À VALIDER : la table ci-dessous est volontairement conservatrice. Elle ne
 * retient qu'une correspondance sûre (mots entiers, sans accent ni casse) ; un secteur ambigu
 * ou inconnu retombe sur « général ». Le consultant peut toujours changer la valeur proposée.
 */
import type { RedSecteur } from "@missionpilot/shared";

/** Mots-clés (déjà normalisés) → secteur du redressement. Ordre = priorité. */
export const CORRESPONDANCE_SECTEURS_CLIENT: readonly {
  secteur: Exclude<RedSecteur, "general">;
  motsCles: readonly string[];
}[] = [
  {
    secteur: "agriculture",
    motsCles: [
      "agriculture",
      "agro-industrie",
      "agroindustrie",
      "agroalimentaire",
      "elevage",
      "peche",
      "agro",
    ],
  },
  {
    secteur: "btp",
    motsCles: ["btp", "batiment", "travaux publics", "construction", "genie civil"],
  },
  {
    secteur: "industrie",
    motsCles: ["industrie", "industriel", "manufacture", "fabrication", "mines", "mining"],
  },
  {
    secteur: "commerce",
    motsCles: [
      "commerce",
      "distribution",
      "negoce",
      "grande distribution",
      "commerce de gros",
      "commerce de detail",
    ],
  },
  {
    secteur: "services",
    motsCles: [
      "services",
      "service",
      "conseil",
      "transport",
      "logistique",
      "transport et logistique",
      "microfinance",
      "banque",
      "assurance",
      "telecoms",
      "hotellerie",
      "tourisme",
      "sante",
      "education",
    ],
  },
];

const normaliser = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .trim();

/**
 * Secteur du redressement proposé pour un secteur libre de client. Correspondance exacte du texte
 * normalisé ou d'un mot-clé comme suite de mots entiers ; en cas de deux secteurs possibles
 * (« Agro-industrie et commerce »), aucune correspondance sûre : « général ».
 */
export function secteurRedressementDepuisClient(
  secteurClient: string | null | undefined,
): RedSecteur {
  if (typeof secteurClient !== "string") return "general";
  const texte = ` ${normaliser(secteurClient)} `;
  if (texte.trim() === "") return "general";
  const trouves = new Set<RedSecteur>();
  for (const { secteur, motsCles } of CORRESPONDANCE_SECTEURS_CLIENT) {
    if (motsCles.some((m) => texte.includes(` ${m} `))) trouves.add(secteur);
  }
  const [premier] = [...trouves];
  return trouves.size === 1 && premier ? premier : "general";
}

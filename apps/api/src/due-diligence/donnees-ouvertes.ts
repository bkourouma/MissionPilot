/*
 * DD-02 « connecteurs de données ouvertes » : REPOUSSÉ, point OUVERT (SPEC-3b §8.12, ADR-012). Ce
 * fichier ne fixe que le contrat d'un fournisseur et fournit un adaptateur SIMULÉ :
 * - AUCUN import depuis une route ni depuis la configuration, AUCUN appel réseau (`fetch`, `http`,
 *   `undici` interdits : recherche mécanique DD1) ;
 * - les valeurs sont FICTIVES et marquées `simule: true` ; aucune n'est présentable comme une
 *   preuve (ce type n'est assignable ni à `preuveCreationSchema` ni à un paramètre de
 *   dimensionnement : test `dd-donnees-ouvertes.test.ts`) ;
 * - la mise en œuvre réelle (Banque mondiale, FMI, ONUDI) dépend de l'ingestion (ADR-009, absente),
 *   du choix des sources et d'un fournisseur : lot ultérieur.
 */

export interface PointDonnee {
  readonly annee: number;
  /** Entier, dans l'unité précisée par `unite`. */
  readonly valeur: number;
  readonly unite: string;
  readonly source: string;
  /** Toujours vrai pour l'adaptateur de ce lot : donnée fictive, jamais une preuve. */
  readonly simule: boolean;
}

export interface FournisseurDonneesOuvertes {
  readonly identifiant: string;
  rechercherIndicateur(paysCode: string, indicateur: string): Promise<readonly PointDonnee[]>;
}

export const SOURCE_SIMULEE = "Données simulées : aucun connecteur réel";

/** Valeurs fictives, déterministes, pour fixer le contrat ; jamais branchées à une route. */
export const fournisseurSimule: FournisseurDonneesOuvertes = {
  identifiant: "simule",
  rechercherIndicateur(paysCode, indicateur) {
    const graine = [...`${paysCode}:${indicateur}`].reduce((s, c) => s + c.charCodeAt(0), 0);
    return Promise.resolve(
      [2022, 2023, 2024].map((annee, i) => ({
        annee,
        valeur: 1_000 + graine + i * 10,
        unite: "unité fictive",
        source: SOURCE_SIMULEE,
        simule: true,
      })),
    );
  },
};

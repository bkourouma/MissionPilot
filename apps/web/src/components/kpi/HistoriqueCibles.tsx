import { formaterDate, formaterDateHeure } from "../../lib/format";
import { formaterValeurKpi, type CibleKpiVue } from "../../lib/kpi";
import { Tableau } from "../ui/Tableau";

export interface HistoriqueCiblesProps {
  cibles: readonly CibleKpiVue[];
  unite: string;
  /** Noms connus des auteurs (référentiel des collaborateurs). */
  noms: ReadonlyMap<string, string>;
}

/**
 * Historique des cibles (ajout seul, migration 0160) : chaque version reste, dans l'ordre de
 * l'API (date d'application, puis version). La cible d'une période est la dernière version
 * applicable à son début, choisie par l'API.
 */
export function HistoriqueCibles({ cibles, unite, noms }: HistoriqueCiblesProps) {
  return (
    <Tableau
      legende="Versions de la cible"
      colonnes={[
        { cle: "version", entete: "Version", rendu: (c: CibleKpiVue) => `v${c.version}` },
        {
          cle: "valeur",
          entete: "Cible",
          alignement: "droite",
          rendu: (c) => (c.valeur === null ? "Sans cible" : formaterValeurKpi(c.valeur, unite)),
        },
        { cle: "a_partir_de", entete: "À partir du", rendu: (c) => formaterDate(c.a_partir_de) },
        { cle: "motif", entete: "Motif", rendu: (c) => c.motif ?? "—" },
        {
          cle: "cree_le",
          entete: "Publiée",
          rendu: (c) =>
            `${formaterDateHeure(c.cree_le)} par ${noms.get(c.cree_par) ?? "un utilisateur du cabinet"}`,
        },
      ]}
      lignes={cibles}
      cleLigne={(c) => `${c.version}-${c.a_partir_de}`}
      messageVide="Aucune cible définie : le KPI reste « Sans cible » et n'entre pas dans le score."
    />
  );
}

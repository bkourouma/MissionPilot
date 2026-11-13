import { formaterDate, formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function HistoriqueCibles({ cibles, unite, noms }: HistoriqueCiblesProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Tableau
      legende={t("Versions de la cible", "Target versions")}
      colonnes={[
        {
          cle: "version",
          entete: t("Version", "Version"),
          rendu: (c: CibleKpiVue) => `v${c.version}`,
        },
        {
          cle: "valeur",
          entete: t("Cible", "Target"),
          alignement: "droite",
          rendu: (c) =>
            c.valeur === null
              ? t("Sans cible", "No target")
              : formaterValeurKpi(c.valeur, unite, langue),
        },
        {
          cle: "a_partir_de",
          entete: t("À partir du", "Effective from"),
          rendu: (c) => formaterDate(c.a_partir_de, "UTC", langue),
        },
        { cle: "motif", entete: t("Motif", "Reason"), rendu: (c) => c.motif ?? "—" },
        {
          cle: "cree_le",
          entete: t("Publiée", "Published"),
          rendu: (c) =>
            t(
              `${formaterDateHeure(c.cree_le, undefined, langue)} par ${noms.get(c.cree_par) ?? "un utilisateur du cabinet"}`,
              `${formaterDateHeure(c.cree_le, undefined, langue)} by ${noms.get(c.cree_par) ?? "a firm user"}`,
            ),
        },
      ]}
      lignes={cibles}
      cleLigne={(c) => `${c.version}-${c.a_partir_de}`}
      messageVide={t(
        "Aucune cible définie : le KPI reste « Sans cible » et n'entre pas dans le score.",
        'No target defined: the KPI stays "No target" and is not part of the score.',
      )}
    />
  );
}

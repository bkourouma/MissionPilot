import { formaterDate, formaterPourcentage } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { formaterValeurKpi } from "../../lib/kpi";
import {
  libelleRelation,
  ordonnerNoeudsArbre,
  texteContribution,
  texteFavorable,
  texteResidu,
  type ContributionsArbre,
  type NoeudContribution,
} from "../../lib/kpi-pilotage";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";

export interface ContributionsArbreProps {
  contributions: ContributionsArbre;
}

/**
 * Décomposition de la variation du KPI racine entre deux dates d'arrêté (KPI-13) : valeur de chaque
 * nœud avant et après, contribution à la variation du parent et de la racine, part de la
 * variation. Tous les chiffres sont ceux du moteur ; un levier non mesuré rend l'arbre non
 * évaluable et est nommé. Une corrélation dans le temps n'est pas une preuve de causalité.
 */
export async function ContributionsArbreKpi({ contributions: c }: ContributionsArbreProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const u = c.unite;
  const libelle = new Map(c.noeuds.map((n) => [n.id, n.libelle]));
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">
        {t(
          `Entre le ${formaterDate(c.avant, "UTC", langue)} et le ${formaterDate(c.apres, "UTC", langue)}, sur la dernière période close mesurée de chaque KPI à ces dates.`,
          `Between ${formaterDate(c.avant, "UTC", langue)} and ${formaterDate(c.apres, "UTC", langue)}, over the last closed measured period of each KPI at these dates.`,
        )}
        {c.variation_racine !== null
          ? t(
              ` Variation du KPI racine : ${texteContribution(c.variation_racine, u, langue)}.`,
              ` Change in the root KPI: ${texteContribution(c.variation_racine, u, langue)}.`,
            )
          : ""}
      </p>
      {(c.avertissements_unites ?? []).length > 0 ? (
        <Alerte
          tonalite="attention"
          titre={t(
            "Unités différentes : la somme n'a pas de sens",
            "Different units: the sum makes no sense",
          )}
          annonce="status"
        >
          <p>
            {t(
              "Ces leviers sont additionnés à un nœud dont l'unité est différente : leur contribution n'est pas interprétable. Liez un KPI de même unité, ou faites combiner le nœud parent par un produit.",
              "These drivers are added to a node whose unit is different: their contribution cannot be interpreted. Link a KPI with the same unit, or have the parent node combined by a product.",
            )}
          </p>
          <ul>
            {(c.avertissements_unites ?? []).map((a) => (
              <li key={`${a.parent_id}-${a.noeud_id}`}>
                {t(
                  `« ${a.noeud_libelle} » est en « ${a.unite} » sous « ${a.parent_libelle} » (${a.unite_reference})`,
                  `"${a.noeud_libelle}" is in "${a.unite}" under "${a.parent_libelle}" (${a.unite_reference})`,
                )}
              </li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {!c.evaluable ? (
        <Alerte
          tonalite="attention"
          titre={t("Décomposition incomplète", "Incomplete breakdown")}
          annonce="status"
        >
          <p>
            {t(
              "Ces leviers n'ont pas de valeur aux deux dates : liez-les à un KPI mesuré ou désactivez-les.",
              "These drivers have no value at both dates: link them to a measured KPI or disable them.",
            )}
          </p>
          <ul>
            {c.manquants.map((m) => (
              <li key={m.noeud_id}>{m.libelle}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {c.leviers.length > 0 ? (
        <Tableau
          legende={t(
            "Leviers classés par contribution à la variation du KPI racine",
            "Drivers ranked by contribution to the change in the root KPI",
          )}
          colonnes={[
            { cle: "rang", entete: t("Rang", "Rank"), alignement: "droite" },
            {
              cle: "libelle",
              entete: t("Levier", "Driver"),
              rendu: (l) => libelle.get(l.noeud_id) ?? l.libelle,
            },
            {
              cle: "contribution",
              entete: t("Contribution", "Contribution"),
              alignement: "droite",
              rendu: (l) => texteContribution(l.contribution_racine, u, langue),
            },
            {
              cle: "part",
              entete: t("Part de la variation", "Share of the change"),
              alignement: "droite",
              rendu: (l) => formaterPourcentage(l.part_racine, 1, langue),
            },
            {
              cle: "sens",
              entete: t("Effet sur le KPI racine", "Effect on the root KPI"),
              rendu: (l) => (
                <BadgeStatut
                  tonalite={l.favorable === null ? "neutre" : l.favorable ? "succes" : "danger"}
                >
                  {texteFavorable(l.favorable, langue)}
                </BadgeStatut>
              ),
            },
          ]}
          lignes={c.leviers}
          cleLigne={(l) => l.noeud_id}
        />
      ) : null}
      <Tableau<NoeudContribution>
        legende={t(
          "Arbre d'indicateurs : valeurs et contributions de chaque nœud",
          "KPI tree: values and contributions of each node",
        )}
        colonnes={[
          {
            cle: "noeud",
            entete: t("Nœud", "Node"),
            rendu: (n) => (
              <span style={{ paddingInlineStart: `${n.profondeur * 1.25}rem` }}>
                {n.libelle}
                {n.feuille ? "" : ` (${libelleRelation(n.relation, langue).toLowerCase()})`}
                {n.kpi_libelle && n.kpi_libelle !== n.libelle ? ` — ${n.kpi_libelle}` : ""}
              </span>
            ),
          },
          {
            cle: "avant",
            entete: t("Avant", "Before"),
            alignement: "droite",
            rendu: (n) => formaterValeurKpi(n.avant, n.kpi_unite ?? u, langue),
          },
          {
            cle: "apres",
            entete: t("Après", "After"),
            alignement: "droite",
            rendu: (n) => formaterValeurKpi(n.apres, n.kpi_unite ?? u, langue),
          },
          {
            cle: "variation",
            entete: t("Variation", "Change"),
            alignement: "droite",
            rendu: (n) => texteContribution(n.variation, "", langue),
          },
          {
            cle: "contribution_parent",
            entete: t("Contribution au parent", "Contribution to parent"),
            alignement: "droite",
            rendu: (n) => texteContribution(n.contribution_parent, "", langue),
          },
          {
            cle: "contribution_racine",
            entete: t("Contribution à la racine", "Contribution to root"),
            alignement: "droite",
            rendu: (n) => texteContribution(n.contribution_racine, "", langue),
          },
          {
            cle: "residu",
            entete: t("Non expliqué par l'arbre", "Not explained by the tree"),
            alignement: "droite",
            rendu: (n) => texteResidu(n.residu_avant, n.residu_apres, n.kpi_unite ?? u, langue),
          },
        ]}
        lignes={ordonnerNoeudsArbre(c.noeuds)}
        cleLigne={(n) => n.id}
      />
    </div>
  );
}

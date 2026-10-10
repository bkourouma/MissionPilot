import { formaterDate, formaterPourcentage } from "../../lib/format";
import { formaterValeurKpi } from "../../lib/kpi";
import {
  LIBELLES_RELATION,
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
export function ContributionsArbreKpi({ contributions: c }: ContributionsArbreProps) {
  const u = c.unite;
  const libelle = new Map(c.noeuds.map((n) => [n.id, n.libelle]));
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">
        Entre le {formaterDate(c.avant)} et le {formaterDate(c.apres)}, sur la dernière période
        close mesurée de chaque KPI à ces dates.
        {c.variation_racine !== null
          ? ` Variation du KPI racine : ${texteContribution(c.variation_racine, u)}.`
          : ""}
      </p>
      {(c.avertissements_unites ?? []).length > 0 ? (
        <Alerte
          tonalite="attention"
          titre="Unités différentes : la somme n'a pas de sens"
          annonce="status"
        >
          <p>
            Ces leviers sont additionnés à un nœud dont l'unité est différente : leur contribution
            n'est pas interprétable. Liez un KPI de même unité, ou faites combiner le nœud parent
            par un produit.
          </p>
          <ul>
            {(c.avertissements_unites ?? []).map((a) => (
              <li key={`${a.parent_id}-${a.noeud_id}`}>
                « {a.noeud_libelle} » est en « {a.unite} » sous « {a.parent_libelle} » (
                {a.unite_reference})
              </li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {!c.evaluable ? (
        <Alerte tonalite="attention" titre="Décomposition incomplète" annonce="status">
          <p>
            Ces leviers n&apos;ont pas de valeur aux deux dates : liez-les à un KPI mesuré ou
            désactivez-les.
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
          legende="Leviers classés par contribution à la variation du KPI racine"
          colonnes={[
            { cle: "rang", entete: "Rang", alignement: "droite" },
            {
              cle: "libelle",
              entete: "Levier",
              rendu: (l) => libelle.get(l.noeud_id) ?? l.libelle,
            },
            {
              cle: "contribution",
              entete: "Contribution",
              alignement: "droite",
              rendu: (l) => texteContribution(l.contribution_racine, u),
            },
            {
              cle: "part",
              entete: "Part de la variation",
              alignement: "droite",
              rendu: (l) => formaterPourcentage(l.part_racine, 1),
            },
            {
              cle: "sens",
              entete: "Effet sur le KPI racine",
              rendu: (l) => (
                <BadgeStatut
                  tonalite={l.favorable === null ? "neutre" : l.favorable ? "succes" : "danger"}
                >
                  {texteFavorable(l.favorable)}
                </BadgeStatut>
              ),
            },
          ]}
          lignes={c.leviers}
          cleLigne={(l) => l.noeud_id}
        />
      ) : null}
      <Tableau<NoeudContribution>
        legende="Arbre d'indicateurs : valeurs et contributions de chaque nœud"
        colonnes={[
          {
            cle: "noeud",
            entete: "Nœud",
            rendu: (n) => (
              <span style={{ paddingInlineStart: `${n.profondeur * 1.25}rem` }}>
                {n.libelle}
                {n.feuille ? "" : ` (${LIBELLES_RELATION[n.relation].toLowerCase()})`}
                {n.kpi_libelle && n.kpi_libelle !== n.libelle ? ` — ${n.kpi_libelle}` : ""}
              </span>
            ),
          },
          {
            cle: "avant",
            entete: "Avant",
            alignement: "droite",
            rendu: (n) => formaterValeurKpi(n.avant, n.kpi_unite ?? u),
          },
          {
            cle: "apres",
            entete: "Après",
            alignement: "droite",
            rendu: (n) => formaterValeurKpi(n.apres, n.kpi_unite ?? u),
          },
          {
            cle: "variation",
            entete: "Variation",
            alignement: "droite",
            rendu: (n) => texteContribution(n.variation),
          },
          {
            cle: "contribution_parent",
            entete: "Contribution au parent",
            alignement: "droite",
            rendu: (n) => texteContribution(n.contribution_parent),
          },
          {
            cle: "contribution_racine",
            entete: "Contribution à la racine",
            alignement: "droite",
            rendu: (n) => texteContribution(n.contribution_racine),
          },
          {
            cle: "residu",
            entete: "Non expliqué par l'arbre",
            alignement: "droite",
            rendu: (n) => texteResidu(n.residu_avant, n.residu_apres, n.kpi_unite ?? u),
          },
        ]}
        lignes={ordonnerNoeudsArbre(c.noeuds)}
        cleLigne={(n) => n.id}
      />
    </div>
  );
}

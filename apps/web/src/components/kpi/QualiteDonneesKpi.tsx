import Link from "next/link";
import { formaterDate } from "../../lib/format";
import { hrefKpi } from "../../lib/kpi";
import {
  libelleMotifQualite,
  libelleNiveauQualite,
  texteComposante,
  texteScoreQualite,
  type NiveauQualite,
  type QualiteMission,
} from "../../lib/kpi-pilotage";
import { BadgeStatut, type TonaliteStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";

const TONALITE: Record<NiveauQualite, TonaliteStatut> = {
  bon: "succes",
  moyen: "attention",
  faible: "danger",
};

type Ligne = QualiteMission["kpis"][number];

export interface QualiteDonneesKpiProps {
  qualite: QualiteMission;
  missionId: string;
}

/**
 * Qualité des données de chaque KPI (KPI-15), sous le score composite : fraîcheur, complétude et
 * cohérence calculées par le moteur à la date d'arrêté. Le niveau est toujours écrit (icône ET
 * mot) ; les motifs disent quoi corriger. Un score faible n'altère ni le statut ni le score
 * composite du KPI : il prévient seulement que la lecture est moins fiable.
 */
export function QualiteDonneesKpi({ qualite, missionId }: QualiteDonneesKpiProps) {
  const r = qualite.repartition;
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">
        Au {formaterDate(qualite.date_reference)} : {r.bon} KPI à données de bonne qualité,{" "}
        {r.moyen} de qualité moyenne, {r.faible} de qualité faible
        {r.non_evaluable > 0 ? `, ${r.non_evaluable} non évaluable(s)` : ""}. Fraîcheur : retard de
        mesure ; complétude : périodes échues mesurées ; cohérence : corrections et valeurs
        inhabituelles.
      </p>
      <Tableau<Ligne>
        legende="Qualité des données par KPI"
        colonnes={[
          {
            cle: "kpi",
            entete: "KPI",
            rendu: (l) => <Link href={hrefKpi(missionId, l.kpi_id)}>{l.libelle}</Link>,
          },
          {
            cle: "niveau",
            entete: "Qualité",
            rendu: (l) =>
              l.qualite.niveau ? (
                <BadgeStatut tonalite={TONALITE[l.qualite.niveau]}>
                  {libelleNiveauQualite(l.qualite.niveau)} ({texteScoreQualite(l.qualite.score)})
                </BadgeStatut>
              ) : (
                libelleNiveauQualite(null)
              ),
          },
          {
            cle: "fraicheur",
            entete: "Fraîcheur",
            alignement: "droite",
            rendu: (l) => texteComposante(l.qualite.fraicheur),
          },
          {
            cle: "completude",
            entete: "Complétude",
            alignement: "droite",
            rendu: (l) => texteComposante(l.qualite.completude),
          },
          {
            cle: "coherence",
            entete: "Cohérence",
            alignement: "droite",
            rendu: (l) => texteComposante(l.qualite.coherence),
          },
          {
            cle: "motifs",
            entete: "À corriger",
            rendu: (l) =>
              l.qualite.motifs.length === 0
                ? "Rien à signaler"
                : l.qualite.motifs.map(libelleMotifQualite).join(" ; "),
          },
        ]}
        lignes={qualite.kpis}
        cleLigne={(l) => l.kpi_id}
        messageVide="Aucun KPI actif à évaluer."
      />
    </div>
  );
}

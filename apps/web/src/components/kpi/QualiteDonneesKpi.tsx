import Link from "next/link";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function QualiteDonneesKpi({ qualite, missionId }: QualiteDonneesKpiProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = qualite.repartition;
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">
        {t(
          `Au ${formaterDate(qualite.date_reference, "UTC", langue)} : ${r.bon} KPI à données de bonne qualité, ${r.moyen} de qualité moyenne, ${r.faible} de qualité faible${r.non_evaluable > 0 ? `, ${r.non_evaluable} non évaluable(s)` : ""}. Fraîcheur : retard de mesure ; complétude : périodes échues mesurées ; cohérence : corrections et valeurs inhabituelles.`,
          `As of ${formaterDate(qualite.date_reference, "UTC", langue)}: ${r.bon} KPI(s) with good-quality data, ${r.moyen} of medium quality, ${r.faible} of low quality${r.non_evaluable > 0 ? `, ${r.non_evaluable} not assessable` : ""}. Freshness: measurement delay; completeness: due periods measured; consistency: corrections and unusual values.`,
        )}
      </p>
      <Tableau<Ligne>
        legende={t("Qualité des données par KPI", "Data quality by KPI")}
        colonnes={[
          {
            cle: "kpi",
            entete: "KPI",
            rendu: (l) => <Link href={hrefKpi(missionId, l.kpi_id)}>{l.libelle}</Link>,
          },
          {
            cle: "niveau",
            entete: t("Qualité", "Quality"),
            rendu: (l) =>
              l.qualite.niveau ? (
                <BadgeStatut tonalite={TONALITE[l.qualite.niveau]}>
                  {libelleNiveauQualite(l.qualite.niveau, langue)} (
                  {texteScoreQualite(l.qualite.score, langue)})
                </BadgeStatut>
              ) : (
                libelleNiveauQualite(null, langue)
              ),
          },
          {
            cle: "fraicheur",
            entete: t("Fraîcheur", "Freshness"),
            alignement: "droite",
            rendu: (l) => texteComposante(l.qualite.fraicheur, langue),
          },
          {
            cle: "completude",
            entete: t("Complétude", "Completeness"),
            alignement: "droite",
            rendu: (l) => texteComposante(l.qualite.completude, langue),
          },
          {
            cle: "coherence",
            entete: t("Cohérence", "Consistency"),
            alignement: "droite",
            rendu: (l) => texteComposante(l.qualite.coherence, langue),
          },
          {
            cle: "motifs",
            entete: t("À corriger", "To fix"),
            rendu: (l) =>
              l.qualite.motifs.length === 0
                ? t("Rien à signaler", "Nothing to report")
                : l.qualite.motifs.map((m) => libelleMotifQualite(m, langue)).join(" ; "),
          },
        ]}
        lignes={qualite.kpis}
        cleLigne={(l) => l.kpi_id}
        messageVide={t("Aucun KPI actif à évaluer.", "No active KPI to assess.")}
      />
    </div>
  );
}

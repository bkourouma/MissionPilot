import Link from "next/link";
import {
  FREQUENCE_LIBELLES,
  formaterValeurKpi,
  hrefKpi,
  libellePeriode,
  SENS_LIBELLES,
  texteAtteinte,
  texteEcart,
  texteProjection,
  type KpiTableau,
} from "../../lib/kpi";
import { BadgeStatutKpi } from "./BadgeStatutKpi";
import { ListeAlertesKpi } from "./ListeAlertesKpi";
import { TendanceKpi } from "./TendanceKpi";

export interface CarteKpiProps {
  kpi: KpiTableau;
  missionId: string;
  /** Niveau du titre (3 dans le tableau de bord, sous la perspective). */
  niveauTitre?: 3 | 4;
  /** Lien vers la fiche du KPI (absent sur la fiche elle-même). */
  avecLien?: boolean;
}

/**
 * Situation d'un KPI à la date d'arrêté, telle que le moteur l'a évaluée : statut (texte et
 * icône), dernière période close mesurée (valeur, cible, atteinte, écart), tendance, période
 * en cours (réalisé partiel, projection, statut projeté) et alertes.
 */
export function CarteKpi({ kpi, missionId, niveauTitre = 3, avecLien = true }: CarteKpiProps) {
  const Titre = `h${niveauTitre}` as const;
  const d = kpi.derniere_periode;
  const e = kpi.periode_en_cours;
  return (
    <article className="mp-kpi-carte" aria-label={kpi.libelle}>
      <header className="mp-kpi-carte__entete">
        <Titre className="mp-kpi-carte__titre">
          {avecLien ? <Link href={hrefKpi(missionId, kpi.id)}>{kpi.libelle}</Link> : kpi.libelle}
        </Titre>
        <BadgeStatutKpi statut={kpi.statut} />
      </header>
      <p className="mp-kpi-carte__valeur">
        {d ? (
          <>
            <span className="mp-kpi-carte__chiffre">{formaterValeurKpi(d.valeur, kpi.unite)}</span>
            <span className="mp-texte-doux"> en {libellePeriode(d.periode)}</span>
          </>
        ) : (
          <span className="mp-texte-doux">Aucune période close mesurée à cette date.</span>
        )}
      </p>
      <dl className="mp-kpi-mesures">
        <div>
          <dt>Cible</dt>
          <dd>
            {d
              ? d.cible === null
                ? "Aucune cible pour cette période"
                : formaterValeurKpi(d.cible, kpi.unite)
              : kpi.cible_actuelle === null
                ? "Aucune cible en vigueur"
                : `${formaterValeurKpi(kpi.cible_actuelle, kpi.unite)} (en vigueur)`}
          </dd>
        </div>
        {d?.atteinte ? (
          <div>
            <dt>Atteinte</dt>
            <dd>{texteAtteinte(d.atteinte)}</dd>
          </div>
        ) : null}
        {d?.ecart ? (
          <div>
            <dt>Écart à la cible</dt>
            <dd>{texteEcart(d.ecart, kpi.unite)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Tendance</dt>
          <dd>
            <TendanceKpi tendance={kpi.tendance} />
          </dd>
        </div>
        {e ? (
          <div>
            <dt>Période en cours ({libellePeriode(e.periode)})</dt>
            <dd className="mp-kpi-mesures__pile">
              <span>
                Réalisé à date :{" "}
                {e.valeur === null
                  ? "aucune mesure"
                  : `${formaterValeurKpi(e.valeur, kpi.unite)} (${e.nombre_mesures} mesure${e.nombre_mesures > 1 ? "s" : ""})`}
              </span>
              <span>Projection : {texteProjection(e.projection, kpi.unite)}</span>
              <span>
                <BadgeStatutKpi statut={e.statut_projete} prefixe="Statut projeté : " />
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
      {kpi.alertes.length > 0 ? (
        <ListeAlertesKpi
          missionId={missionId}
          alertes={kpi.alertes.map(({ code, periode, ...donnees }, i) => ({
            cle: `${code}-${periode}-${i}`,
            code,
            periode,
            unite: kpi.unite,
            donnees,
          }))}
        />
      ) : null}
      <p className="mp-texte-doux mp-texte-petit">
        {SENS_LIBELLES[kpi.sens]} · {FREQUENCE_LIBELLES[kpi.frequence]} ·{" "}
        {kpi.nature === "flux" ? "flux (somme de la période)" : "stock (dernière valeur)"} · poids{" "}
        {kpi.ponderation.toLocaleString("fr-FR")}
      </p>
    </article>
  );
}

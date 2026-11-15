import { LOCALES_INTL } from "@missionpilot/shared";
import Link from "next/link";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterValeurKpi,
  hrefKpi,
  libelleFrequence,
  libellePeriode,
  libelleSens,
  texteAtteinte,
  texteEcart,
  type KpiTableau,
} from "../../lib/kpi";
import { texteProjectionArrondie } from "../../lib/kpi-pilotage";
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
export async function CarteKpi({
  kpi,
  missionId,
  niveauTitre = 3,
  avecLien = true,
}: CarteKpiProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const Titre = `h${niveauTitre}` as const;
  const d = kpi.derniere_periode;
  const e = kpi.periode_en_cours;
  return (
    <article className="mp-kpi-carte" aria-label={kpi.libelle}>
      <header className="mp-kpi-carte__entete">
        <Titre className="mp-kpi-carte__titre">
          {avecLien ? <Link href={hrefKpi(missionId, kpi.id)}>{kpi.libelle}</Link> : kpi.libelle}
        </Titre>
        <BadgeStatutKpi statut={kpi.statut} langue={langue} />
      </header>
      <p className="mp-kpi-carte__valeur">
        {d ? (
          <>
            <span className="mp-kpi-carte__chiffre">
              {formaterValeurKpi(d.valeur, kpi.unite, langue)}
            </span>
            <span className="mp-texte-doux">
              {" "}
              {t("en", "in")} {libellePeriode(d.periode, langue)}
            </span>
          </>
        ) : (
          <span className="mp-texte-doux">
            {t(
              "Aucune période close mesurée à cette date.",
              "No closed period measured at this date.",
            )}
          </span>
        )}
      </p>
      <dl className="mp-kpi-mesures">
        <div>
          <dt>{t("Cible", "Target")}</dt>
          <dd>
            {d
              ? d.cible === null
                ? t("Aucune cible pour cette période", "No target for this period")
                : formaterValeurKpi(d.cible, kpi.unite, langue)
              : kpi.cible_actuelle === null
                ? t("Aucune cible en vigueur", "No target in effect")
                : `${formaterValeurKpi(kpi.cible_actuelle, kpi.unite, langue)} ${t("(en vigueur)", "(in effect)")}`}
          </dd>
        </div>
        {d?.atteinte ? (
          <div>
            <dt>{t("Atteinte", "Attainment")}</dt>
            <dd>{texteAtteinte(d.atteinte, langue)}</dd>
          </div>
        ) : null}
        {d?.ecart ? (
          <div>
            <dt>{t("Écart à la cible", "Gap to target")}</dt>
            <dd>{texteEcart(d.ecart, kpi.unite, langue)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("Tendance", "Trend")}</dt>
          <dd>
            <TendanceKpi tendance={kpi.tendance} />
          </dd>
        </div>
        {e ? (
          <div>
            <dt>
              {t("Période en cours", "Current period")} ({libellePeriode(e.periode, langue)})
            </dt>
            <dd className="mp-kpi-mesures__pile">
              <span>
                {t("Réalisé à date :", "Actual to date:")}{" "}
                {e.valeur === null
                  ? t("aucune mesure", "no measurement")
                  : t(
                      `${formaterValeurKpi(e.valeur, kpi.unite, langue)} (${e.nombre_mesures} mesure${e.nombre_mesures > 1 ? "s" : ""})`,
                      `${formaterValeurKpi(e.valeur, kpi.unite, langue)} (${e.nombre_mesures} measurement${e.nombre_mesures > 1 ? "s" : ""})`,
                    )}
              </span>
              <span>
                {t("Projection :", "Projection:")}{" "}
                {texteProjectionArrondie(e.projection, kpi.unite, langue)}
              </span>
              <span>
                <BadgeStatutKpi
                  statut={e.statut_projete}
                  prefixe={t("Statut projeté : ", "Projected status: ")}
                  langue={langue}
                />
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
        {libelleSens(kpi.sens, langue)} · {libelleFrequence(kpi.frequence, langue)} ·{" "}
        {kpi.nature === "flux"
          ? t("flux (somme de la période)", "flow (sum of the period)")
          : t("stock (dernière valeur)", "stock (last value)")}{" "}
        · {t("poids", "weight")} {kpi.ponderation.toLocaleString(LOCALES_INTL[langue])}
      </p>
    </article>
  );
}

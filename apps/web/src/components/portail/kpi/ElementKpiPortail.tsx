import Link from "next/link";
import { BadgeStatut } from "../../ui/BadgeStatut";
import { Carte } from "../../ui/Carte";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { formaterValeurKpi, libellePeriode } from "../../../lib/kpi";
import {
  etatSaisieKpi,
  hrefKpiPortail,
  libelleFrequence,
  type KpiPortail,
} from "../../../lib/portail-kpi";
import "../../kpi/kpi.css";

/** Un KPI à renseigner dans la liste : fréquence, période en cours, cible en vigueur. */
export async function ElementKpiPortail({
  kpi,
  aujourdhui,
}: {
  kpi: KpiPortail;
  /** Date du jour « AAAA-MM-JJ » (calculée côté serveur). */
  aujourdhui: string;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const etat = etatSaisieKpi(kpi, aujourdhui, langue);
  return (
    <Carte
      className="mp-module"
      niveauTitre={2}
      titre={
        <Link href={hrefKpiPortail(kpi.id)} className="mp-lien-etendu">
          {kpi.libelle}
        </Link>
      }
      actions={
        etat.saisissable ? (
          <BadgeStatut tonalite="attention">{t("À renseigner", "To be filled in")}</BadgeStatut>
        ) : (
          <BadgeStatut tonalite="neutre">{t("Saisie fermée", "Entry closed")}</BadgeStatut>
        )
      }
    >
      <dl className="mp-kpi-mesures">
        <div>
          <dt>{t("Fréquence", "Frequency")}</dt>
          <dd>{libelleFrequence(kpi.frequence, langue)}</dd>
        </div>
        <div>
          <dt>{t("Période en cours", "Current period")}</dt>
          <dd>{libellePeriode(kpi.periode_en_cours, langue)}</dd>
        </div>
        <div>
          <dt>{t("Cible en vigueur", "Target in effect")}</dt>
          <dd>
            {kpi.cible_actuelle === null
              ? t("Pas de cible définie", "No target defined")
              : formaterValeurKpi(kpi.cible_actuelle, kpi.unite, langue)}
          </dd>
        </div>
      </dl>
      {etat.raison ? <p className="mp-texte-doux mp-texte-petit">{etat.raison}</p> : null}
    </Carte>
  );
}

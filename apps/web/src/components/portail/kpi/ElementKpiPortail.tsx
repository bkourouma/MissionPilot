import Link from "next/link";
import { BadgeStatut } from "../../ui/BadgeStatut";
import { Carte } from "../../ui/Carte";
import { formaterValeurKpi, libellePeriode } from "../../../lib/kpi";
import {
  etatSaisieKpi,
  hrefKpiPortail,
  libelleFrequence,
  type KpiPortail,
} from "../../../lib/portail-kpi";
import "../../kpi/kpi.css";

/** Un KPI à renseigner dans la liste : fréquence, période en cours, cible en vigueur. */
export function ElementKpiPortail({
  kpi,
  aujourdhui,
}: {
  kpi: KpiPortail;
  /** Date du jour « AAAA-MM-JJ » (calculée côté serveur). */
  aujourdhui: string;
}) {
  const etat = etatSaisieKpi(kpi, aujourdhui);
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
          <BadgeStatut tonalite="attention">À renseigner</BadgeStatut>
        ) : (
          <BadgeStatut tonalite="neutre">Saisie fermée</BadgeStatut>
        )
      }
    >
      <dl className="mp-kpi-mesures">
        <div>
          <dt>Fréquence</dt>
          <dd>{libelleFrequence(kpi.frequence)}</dd>
        </div>
        <div>
          <dt>Période en cours</dt>
          <dd>{libellePeriode(kpi.periode_en_cours)}</dd>
        </div>
        <div>
          <dt>Cible en vigueur</dt>
          <dd>
            {kpi.cible_actuelle === null
              ? "Pas de cible définie"
              : formaterValeurKpi(kpi.cible_actuelle, kpi.unite)}
          </dd>
        </div>
      </dl>
      {etat.raison ? <p className="mp-texte-doux mp-texte-petit">{etat.raison}</p> : null}
    </Carte>
  );
}

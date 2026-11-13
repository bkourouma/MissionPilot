import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { TableauxPrevisions } from "../../../components/previsions/TableauxPrevisions";
import { Alerte } from "../../../components/ui/Alerte";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { formaterJours, formaterMontantMineur } from "../../../lib/format";
import { libelleMois, notesPrevision, type ReponsePrevisions } from "../../../lib/previsions";
import { obtenirSession } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Prévisions", "Forecasts") };
}

/** Prévisions de chiffre d'affaires et de charge sur 12 mois (AUT-12) : associés et gestionnaires. */
export default async function PagePrevisions() {
  const t = await obtenirT();
  const { utilisateur } = await obtenirSession();
  if (!aPermission(utilisateur.roles, "finance.lire")) redirect("/acces-refuse");
  const r = await chargerServeur<ReponsePrevisions>("/api/previsions");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Prévisions", "Forecasts")}
        soustitre={t(
          "Chiffre d'affaires et charge des 12 prochains mois : carnet signé (échéances non facturées) et pipeline pondéré par la probabilité, contre la capacité de l'équipe.",
          "Revenue and workload for the next 12 months: signed backlog (uninvoiced due dates) and probability-weighted pipeline, against team capacity.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les prévisions n'ont pas pu être calculées.",
            "The forecasts could not be calculated.",
          )}
          message={r.message}
          hrefReessayer="/previsions"
        />
      ) : (
        <Contenu donnees={r.donnees} />
      )}
    </div>
  );
}

async function Contenu({ donnees: d }: { donnees: ReponsePrevisions }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const m = (v: number) => formaterMontantMineur(v, d.devise, langue);
  const notes = notesPrevision(d, m, langue);
  const premier = d.mois[0]?.mois;
  const dernier = d.mois[d.mois.length - 1]?.mois;
  return (
    <>
      <Carte
        titre={
          premier && dernier
            ? t(
                `De ${libelleMois(premier)} à ${libelleMois(dernier)}`,
                `From ${libelleMois(premier, langue)} to ${libelleMois(dernier, langue)}`,
              )
            : t("Horizon", "Horizon")
        }
      >
        <ul className="mp-totaux">
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Carnet signé", "Signed backlog")}</span>
            <span className="mp-totaux__valeur">{m(d.totaux.ca_carnet)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Pipeline pondéré", "Weighted pipeline")}</span>
            <span className="mp-totaux__valeur">{m(d.totaux.ca_pipeline)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Total prévu", "Total forecast")}</span>
            <span className="mp-totaux__valeur">{m(d.totaux.ca_total)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">
              {t("Charge / capacité", "Workload / capacity")}
            </span>
            <span className="mp-totaux__valeur">
              {`${formaterJours(d.totaux.charge_totale_jours, langue)} / ${formaterJours(d.totaux.capacite_jours, langue)}`}
            </span>
          </li>
        </ul>
      </Carte>
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre={t("Comment lire ces chiffres", "How to read these figures")}
      >
        <p>
          {t(
            `Le carnet reprend les échéances de facturation non facturées des missions signées. Le pipeline est pondéré par la probabilité de chaque opportunité, réparti sur ${d.hypotheses.duree_mois} mois à partir du mois qui suit la clôture prévue. Ce sont des estimations de gestion : elles ne remplacent ni la facturation ni le plan de charge.`,
            `The backlog lists the uninvoiced billing due dates of signed engagements. The pipeline is weighted by the probability of each opportunity, spread over ${d.hypotheses.duree_mois} months starting the month after the expected close. These are management estimates: they replace neither invoicing nor the workload plan.`,
          )}
        </p>
      </Alerte>
      {notes.length > 0 ? (
        <Alerte tonalite="attention" annonce="aucune" titre={t("À savoir", "Good to know")}>
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      <TableauxPrevisions donnees={d} />
    </>
  );
}

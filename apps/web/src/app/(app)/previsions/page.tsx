import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { TableauxPrevisions } from "../../../components/previsions/TableauxPrevisions";
import { Alerte } from "../../../components/ui/Alerte";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterJours, formaterMontantMineur } from "../../../lib/format";
import { libelleMois, notesPrevision, type ReponsePrevisions } from "../../../lib/previsions";
import { obtenirSession } from "../../../lib/session";

export const metadata: Metadata = { title: "Prévisions" };

/** Prévisions de chiffre d'affaires et de charge sur 12 mois (AUT-12) : associés et gestionnaires. */
export default async function PagePrevisions() {
  const { utilisateur } = await obtenirSession();
  if (!aPermission(utilisateur.roles, "finance.lire")) redirect("/acces-refuse");
  const r = await chargerServeur<ReponsePrevisions>("/api/previsions");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Prévisions"
        soustitre="Chiffre d'affaires et charge des 12 prochains mois : carnet signé (échéances non facturées) et pipeline pondéré par la probabilité, contre la capacité de l'équipe."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les prévisions n'ont pas pu être calculées."
          message={r.message}
          hrefReessayer="/previsions"
        />
      ) : (
        <Contenu donnees={r.donnees} />
      )}
    </div>
  );
}

function Contenu({ donnees: d }: { donnees: ReponsePrevisions }) {
  const m = (v: number) => formaterMontantMineur(v, d.devise);
  const notes = notesPrevision(d, m);
  const premier = d.mois[0]?.mois;
  const dernier = d.mois[d.mois.length - 1]?.mois;
  return (
    <>
      <Carte
        titre={
          premier && dernier ? `De ${libelleMois(premier)} à ${libelleMois(dernier)}` : "Horizon"
        }
      >
        <ul className="mp-totaux">
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Carnet signé</span>
            <span className="mp-totaux__valeur">{m(d.totaux.ca_carnet)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Pipeline pondéré</span>
            <span className="mp-totaux__valeur">{m(d.totaux.ca_pipeline)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Total prévu</span>
            <span className="mp-totaux__valeur">{m(d.totaux.ca_total)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Charge / capacité</span>
            <span className="mp-totaux__valeur">
              {`${formaterJours(d.totaux.charge_totale_jours)} / ${formaterJours(d.totaux.capacite_jours)}`}
            </span>
          </li>
        </ul>
      </Carte>
      <Alerte tonalite="info" annonce="aucune" titre="Comment lire ces chiffres">
        <p>
          Le carnet reprend les échéances de facturation non facturées des missions signées. Le
          pipeline est pondéré par la probabilité de chaque opportunité, réparti sur{" "}
          {d.hypotheses.duree_mois} mois à partir du mois qui suit la clôture prévue. Ce sont des
          estimations de gestion : elles ne remplacent ni la facturation ni le plan de charge.
        </p>
      </Alerte>
      {notes.length > 0 ? (
        <Alerte tonalite="attention" annonce="aucune" titre="À savoir">
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

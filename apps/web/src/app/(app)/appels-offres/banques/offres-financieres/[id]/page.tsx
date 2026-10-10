import type { Metadata } from "next";
import { FormulaireOffreFinanciere } from "../../../../../../components/banque-ao/FormulairesOffres";
import { ResultatFinancier } from "../../../../../../components/banque-ao/ResultatFinancier";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import {
  droitsBanqueAo,
  RACINE_BANQUES,
  saisieDepuisOffreFinanciere,
  type OffreFinanciereDetail,
} from "../../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Offre financière" };

/** Offre financière : calcul figé de la dernière version, historique, nouvelle version. */
export default async function PageDetailOffreFinanciere({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("finance.lire");
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<OffreFinanciereDetail>(
    `/api/banque-ao/offres-financieres/${encodeURIComponent(id)}`,
  );
  const retour = { href: `${RACINE_BANQUES}/offres-financieres`, libelle: "Offres financières" };
  if (!r.ok || !r.donnees.courante) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Offre financière" retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/offres-financieres/${encodeURIComponent(id)}`}
          titre="Cette offre n'a pas pu être chargée."
          message={r.ok ? "Offre sans version." : r.message}
        />
      </div>
    );
  }
  const o = r.donnees;
  const v = o.courante as NonNullable<OffreFinanciereDetail["courante"]>;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={o.titre}
        soustitre={`Version ${v.version} du ${formaterDate(v.cree_le)}`}
        retour={retour}
      />
      <Carte titre="Calcul">
        <ResultatFinancier resultat={v.resultat} titre="Offre enregistrée" />
      </Carte>
      <Carte titre="Historique des versions">
        <ul>
          {o.versions.map((x) => (
            <li key={x.version}>
              Version {x.version} du {formaterDate(x.cree_le)}
              {x.motif ? ` : ${x.motif}` : " (création)"}
            </li>
          ))}
        </ul>
      </Carte>
      {droits.ecrireFinance ? (
        <Carte titre="Nouvelle version">
          <FormulaireOffreFinanciere
            offreId={o.id}
            initial={saisieDepuisOffreFinanciere(o.titre, v.resultat)}
          />
        </Carte>
      ) : null}
    </div>
  );
}

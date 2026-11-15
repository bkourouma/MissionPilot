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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Offre financière", "Financial bid") };
}

/** Offre financière : calcul figé de la dernière version, historique, nouvelle version. */
export default async function PageDetailOffreFinanciere({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  const { utilisateur } = await exigerPermission("finance.lire");
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<OffreFinanciereDetail>(
    `/api/banque-ao/offres-financieres/${encodeURIComponent(id)}`,
  );
  const retour = {
    href: `${RACINE_BANQUES}/offres-financieres`,
    libelle: t("Offres financières", "Financial bids"),
  };
  if (!r.ok || !r.donnees.courante) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Offre financière", "Financial bid")} retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/offres-financieres/${encodeURIComponent(id)}`}
          titre={t("Cette offre n'a pas pu être chargée.", "This bid could not be loaded.")}
          message={r.ok ? t("Offre sans version.", "Bid without a version.") : r.message}
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
        soustitre={t(
          `Version ${v.version} du ${formaterDate(v.cree_le)}`,
          `Version ${v.version} of ${formaterDate(v.cree_le, "UTC", langue)}`,
        )}
        retour={retour}
      />
      <Carte titre={t("Calcul", "Computation")}>
        <ResultatFinancier
          resultat={v.resultat}
          titre={t("Offre enregistrée", "Saved bid")}
          langue={langue}
        />
      </Carte>
      <Carte titre={t("Historique des versions", "Version history")}>
        <ul>
          {o.versions.map((x) => (
            <li key={x.version}>
              {t(
                `Version ${x.version} du ${formaterDate(x.cree_le)}`,
                `Version ${x.version} of ${formaterDate(x.cree_le, "UTC", langue)}`,
              )}
              {x.motif ? ` : ${x.motif}` : t(" (création)", " (creation)")}
            </li>
          ))}
        </ul>
      </Carte>
      {droits.ecrireFinance ? (
        <Carte titre={t("Nouvelle version", "New version")}>
          <FormulaireOffreFinanciere
            offreId={o.id}
            initial={saisieDepuisOffreFinanciere(o.titre, v.resultat)}
          />
        </Carte>
      ) : null}
    </div>
  );
}

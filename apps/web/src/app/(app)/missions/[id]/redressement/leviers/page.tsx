import type { Metadata } from "next";
import { BibliothequeLeviers } from "../../../../../../components/redressement/BibliothequeLeviers";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { SimulateurLevier } from "../../../../../../components/redressement/SimulateurLevier";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { obtenirT } from "../../../../../../lib/i18n/serveur";
import {
  hrefRedressement,
  TEXTE_LEVIERS,
  TEXTE_LEVIERS_EN,
} from "../../../../../../lib/redressement";
import {
  chargerContexteRed,
  chargerReferentielRed,
} from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Leviers de redressement", "Turnaround levers") };
}

/**
 * Leviers (RED-14) : bibliothèque des six leviers du catalogue du moteur et simulateur. Les
 * impacts sont des ordres de grandeur calculés par le moteur à partir du dernier état accepté.
 */
export default async function PageLeviers({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "leviers")}
      />
    );
  }
  const { dossier, droits } = ctx;
  const referentiel = await chargerReferentielRed();
  if (!referentiel.ok) {
    return (
      <EtatErreur
        titre={t(
          "Le catalogue de leviers n'a pas pu être chargé.",
          "The lever catalog could not be loaded.",
        )}
        message={referentiel.message}
        hrefReessayer={hrefRedressement(id, "leviers")}
      />
    );
  }
  const leviers = referentiel.donnees.leviers;
  return (
    <div className="mp-red">
      <p className="mp-texte-doux">{t(TEXTE_LEVIERS, TEXTE_LEVIERS_EN)}</p>
      <Carte titre={t("Simulateur", "Simulator")}>
        <SimulateurLevier
          missionId={id}
          dossierId={dossier.id}
          devise={dossier.devise}
          leviers={leviers}
        />
      </Carte>
      <section className="mp-red-section" aria-labelledby="titre-bibliotheque">
        <h2 id="titre-bibliotheque" className="mp-red-section__titre">
          {t("Bibliothèque de leviers", "Lever library")}
        </h2>
        <BibliothequeLeviers missionId={id} leviers={leviers} peutCreer={droits.ecrire} />
      </section>
    </div>
  );
}

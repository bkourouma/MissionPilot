import type { Metadata } from "next";
import { BibliothequeLeviers } from "../../../../../../components/redressement/BibliothequeLeviers";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { SimulateurLevier } from "../../../../../../components/redressement/SimulateurLevier";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { hrefRedressement, TEXTE_LEVIERS } from "../../../../../../lib/redressement";
import {
  chargerContexteRed,
  chargerReferentielRed,
} from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Leviers de redressement" };

/**
 * Leviers (RED-14) : bibliothèque des six leviers du catalogue du moteur et simulateur. Les
 * impacts sont des ordres de grandeur calculés par le moteur à partir du dernier état accepté.
 */
export default async function PageLeviers({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
        titre="Le catalogue de leviers n'a pas pu être chargé."
        message={referentiel.message}
        hrefReessayer={hrefRedressement(id, "leviers")}
      />
    );
  }
  const leviers = referentiel.donnees.leviers;
  return (
    <div className="mp-red">
      <p className="mp-texte-doux">{TEXTE_LEVIERS}</p>
      <Carte titre="Simulateur">
        <SimulateurLevier
          missionId={id}
          dossierId={dossier.id}
          devise={dossier.devise}
          leviers={leviers}
        />
      </Carte>
      <section className="mp-red-section" aria-labelledby="titre-bibliotheque">
        <h2 id="titre-bibliotheque" className="mp-red-section__titre">
          Bibliothèque de leviers
        </h2>
        <BibliothequeLeviers missionId={id} leviers={leviers} peutCreer={droits.ecrire} />
      </section>
    </div>
  );
}

import type { Metadata } from "next";
import "../../../../../components/notation/notation.css";
import "../../../../../components/notation-augmentee/notation-augmentee.css";
import { FormulaireItemBanque } from "../../../../../components/notation-augmentee/FormulaireItemBanque";
import { suggestionsDimensions } from "../../../../../components/notation-augmentee/suggestions";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { cheminItemBanque, type ItemBanqueDetail } from "../../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";

export const metadata: Metadata = { title: "Nouvel item de la banque" };

/**
 * Rédaction d'un item (brouillon). Avec `?depuis=<id>`, nouvelle version d'un item existant : le
 * formulaire est prérempli depuis cette version et le code, la dimension et la pratique sont figés ;
 * l'API refuse s'il existe déjà un brouillon pour ce code.
 */
export default async function PageNouvelItemBanque({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerLectureNotation();
  const q = await searchParams;
  const depuis = typeof q.depuis === "string" && estIdentifiant(q.depuis) ? q.depuis : null;
  const retour = { href: "/notation/banque", libelle: "Banque d'items" };

  if (depuis) {
    const r = await chargerServeur<ItemBanqueDetail>(cheminItemBanque(depuis));
    if (!r.ok) {
      return (
        <div className="mp-page">
          <EnteteDePage titre="Nouvelle version d'un item" retour={retour} />
          <EtatErreur
            titre="L'item de départ n'a pas pu être chargé."
            message={r.message}
            hrefReessayer={`/notation/banque/nouveau?depuis=${depuis}`}
          />
        </div>
      );
    }
    const item = r.donnees;
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={`Nouvelle version de « ${item.code} »`}
          retour={retour}
          soustitre={`Préremplie depuis la version ${item.version}. La nouvelle version est un brouillon : un autre expert métier devra la valider, la version actuelle reste en service d'ici là.`}
        />
        <Carte titre="Contenu de la nouvelle version">
          <FormulaireItemBanque
            itemId={null}
            base={item.contenu}
            identifiantsFiges
            suggestions={suggestionsDimensions()}
          />
        </Carte>
      </div>
    );
  }

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Nouvel item"
        retour={retour}
        soustitre="L'item est créé en brouillon. Il ne servira aux questionnaires adaptatifs qu'après validation par un expert métier qui n'en est ni l'auteur ni le dernier modificateur."
      />
      <Carte titre="Contenu de l'item">
        <FormulaireItemBanque
          itemId={null}
          base={null}
          identifiantsFiges={false}
          suggestions={suggestionsDimensions()}
        />
      </Carte>
    </div>
  );
}

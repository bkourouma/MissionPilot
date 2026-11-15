import type { Metadata } from "next";
import "../../../../../components/notation/notation.css";
import "../../../../../components/notation-augmentee/notation-augmentee.css";
import { FormulaireItemBanque } from "../../../../../components/notation-augmentee/FormulaireItemBanque";
import { suggestionsDimensions } from "../../../../../components/notation-augmentee/suggestions";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { cheminItemBanque, type ItemBanqueDetail } from "../../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouvel item de la banque", "New bank item") };
}

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
  const t = await obtenirT();
  await exigerLectureNotation();
  const q = await searchParams;
  const depuis = typeof q.depuis === "string" && estIdentifiant(q.depuis) ? q.depuis : null;
  const retour = { href: "/notation/banque", libelle: t("Banque d'items", "Item bank") };

  if (depuis) {
    const r = await chargerServeur<ItemBanqueDetail>(cheminItemBanque(depuis));
    if (!r.ok) {
      return (
        <div className="mp-page">
          <EnteteDePage
            titre={t("Nouvelle version d'un item", "New version of an item")}
            retour={retour}
          />
          <EtatErreur
            titre={t(
              "L'item de départ n'a pas pu être chargé.",
              "The starting item could not be loaded.",
            )}
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
          titre={t(`Nouvelle version de « ${item.code} »`, `New version of "${item.code}"`)}
          retour={retour}
          soustitre={t(
            `Préremplie depuis la version ${item.version}. La nouvelle version est un brouillon : un autre expert métier devra la valider, la version actuelle reste en service d'ici là.`,
            `Prefilled from version ${item.version}. The new version is a draft: another business expert will have to approve it, and the current version stays in use until then.`,
          )}
        />
        <Carte titre={t("Contenu de la nouvelle version", "Content of the new version")}>
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
        titre={t("Nouvel item", "New item")}
        retour={retour}
        soustitre={t(
          "L'item est créé en brouillon. Il ne servira aux questionnaires adaptatifs qu'après validation par un expert métier qui n'en est ni l'auteur ni le dernier modificateur.",
          "The item is created as a draft. It will be used in adaptive questionnaires only after approval by a business expert who is neither its author nor its last editor.",
        )}
      />
      <Carte titre={t("Contenu de l'item", "Item content")}>
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

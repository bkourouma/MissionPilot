import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import {
  cheminMethodes,
  hrefMethode,
  hrefMethodes,
  libelleOrigine,
  lireCurseur,
  type PageMethodes,
} from "../../../lib/methodes";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Méthodes", "Methods") };
}

/**
 * Catalogue du référentiel de méthodes (STD-02, STD-03) : méthodes du standard CabinetPilot
 * (lecture seule), variantes et méthodes du cabinet, dernière version publiée et brouillon.
 */
export default async function PageCatalogueMethodes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("standard.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<PageMethodes>(cheminMethodes(curseur));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Méthodes", "Methods")}
        soustitre={t(
          "Toutes les missions parlent la même grammaire : méthodes versionnées, étapes, briques, règles de contexte. Le standard CabinetPilot se lit ; le cabinet l'adapte dans ses variantes.",
          "All engagements speak the same grammar: versioned methods, steps, building blocks, context rules. The CabinetPilot standard is read-only; the firm adapts it in its variants.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("Le catalogue n'a pas pu être chargé.", "The catalog could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefMethodes(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune méthode.", "No method.")} icone="livre">
          <p>
            {t(
              "Le standard CabinetPilot n'est pas encore installé sur ce serveur.",
              "The CabinetPilot standard is not yet installed on this server.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {r.donnees.elements.map((m) => (
            <li key={m.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefMethode(m.id)} className="mp-lien-ligne">
                  {m.libelle}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">
                  {m.service_libelle}
                  {m.parent_libelle
                    ? t(
                        ` · variante de « ${m.parent_libelle} »`,
                        ` · variant of "${m.parent_libelle}"`,
                      )
                    : ""}
                  {m.derniere_publiee
                    ? t(
                        ` · version ${m.derniere_publiee.version} publiée le ${formaterDate(m.derniere_publiee.publie_le, undefined, langue)}`,
                        ` · version ${m.derniere_publiee.version} published on ${formaterDate(m.derniere_publiee.publie_le, undefined, langue)}`,
                      )
                    : t(" · aucune version publiée", " · no published version")}
                </span>
              </div>
              <div className="mp-badges">
                <BadgeStatut tonalite={m.origine === "standard" ? "neutre" : "succes"}>
                  {libelleOrigine(m.origine, langue)}
                </BadgeStatut>
                {m.brouillon_id ? (
                  <BadgeStatut tonalite="attention">
                    {t("Brouillon en cours", "Draft in progress")}
                  </BadgeStatut>
                ) : null}
                {m.variante_id ? (
                  <BadgeStatut tonalite="succes">
                    {t("Variante du cabinet", "Firm variant")}
                  </BadgeStatut>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          libelle={t("Pages du catalogue", "Catalog pages")}
          hrefSuivante={r.donnees.curseur_suivant ? hrefMethodes(r.donnees.curseur_suivant) : null}
          hrefDebut={curseur ? hrefMethodes() : null}
        />
      ) : null}
    </div>
  );
}

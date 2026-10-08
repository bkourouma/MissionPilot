import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import {
  cheminMethodes,
  hrefMethode,
  hrefMethodes,
  libelleOrigine,
  lireCurseur,
  type PageMethodes,
} from "../../../lib/methodes";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Méthodes" };

/**
 * Catalogue du référentiel de méthodes (STD-02, STD-03) : méthodes du standard MissionPilot
 * (lecture seule), variantes et méthodes du cabinet, dernière version publiée et brouillon.
 */
export default async function PageCatalogueMethodes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("standard.lire");
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<PageMethodes>(cheminMethodes(curseur));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Méthodes"
        soustitre="Toutes les missions parlent la même grammaire : méthodes versionnées, étapes, briques, règles de contexte. Le standard MissionPilot se lit ; le cabinet l'adapte dans ses variantes."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Le catalogue n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={hrefMethodes(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune méthode." icone="livre">
          <p>Le standard MissionPilot n&apos;est pas encore installé sur ce serveur.</p>
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
                  {m.parent_libelle ? ` · variante de « ${m.parent_libelle} »` : ""}
                  {m.derniere_publiee
                    ? ` · version ${m.derniere_publiee.version} publiée le ${formaterDate(m.derniere_publiee.publie_le)}`
                    : " · aucune version publiée"}
                </span>
              </div>
              <div className="mp-badges">
                <BadgeStatut tonalite={m.origine === "standard" ? "neutre" : "succes"}>
                  {libelleOrigine(m.origine)}
                </BadgeStatut>
                {m.brouillon_id ? (
                  <BadgeStatut tonalite="attention">Brouillon en cours</BadgeStatut>
                ) : null}
                {m.variante_id ? (
                  <BadgeStatut tonalite="succes">Variante du cabinet</BadgeStatut>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          libelle="Pages du catalogue"
          hrefSuivante={r.donnees.curseur_suivant ? hrefMethodes(r.donnees.curseur_suivant) : null}
          hrefDebut={curseur ? hrefMethodes() : null}
        />
      ) : null}
    </div>
  );
}

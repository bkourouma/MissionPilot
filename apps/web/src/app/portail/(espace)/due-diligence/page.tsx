import Link from "next/link";
import type { Metadata } from "next";
import type { PageDdPortail } from "@missionpilot/shared";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { hrefPage, lireCurseur, peut, requetePage } from "../../../../lib/portail";
import {
  AIDE_AUCUNE_NOTE,
  API_DD_PORTAIL,
  CHEMIN_DD_PORTAIL,
  etatRecommandationPortail,
  hrefDdPortail,
  MENTION_LECTURE_SEULE,
  MESSAGE_AUCUNE_NOTE,
  resumeLigneDdPortail,
  type DdPortailPublicationResume,
} from "../../../../lib/portail-dd";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Due diligence" };

/** Notes de due diligence communiquées par le cabinet à l'investisseur, en lecture seule. */
export default async function DueDiligencePortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.dd.lire")) {
    return <NonDisponible titre="Due diligence" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PageDdPortail<DdPortailPublicationResume>>(
    requetePage(API_DD_PORTAIL, curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Due diligence"
        soustitre="Les notes validées que le cabinet vous a communiquées. Vous les consultez et téléchargez leurs documents ; vous ne pouvez rien modifier."
        badges={
          <BadgeStatut tonalite="neutre" sansIcone>
            {MENTION_LECTURE_SEULE}
          </BadgeStatut>
        }
      />
      {!r.ok ? (
        <EtatErreur
          titre="La liste des notes n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_DD_PORTAIL, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={MESSAGE_AUCUNE_NOTE} icone="livre">
          <p>{AIDE_AUCUNE_NOTE}</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((p) => {
            const reco = etatRecommandationPortail(p.recommandation);
            return (
              <li key={p.id}>
                <Carte
                  className="mp-module"
                  niveauTitre={2}
                  titre={
                    <Link href={hrefDdPortail(p.id)} className="mp-lien-etendu">
                      {p.titre}
                    </Link>
                  }
                  actions={<BadgeStatut tonalite={reco.tonalite}>{reco.libelle}</BadgeStatut>}
                >
                  <p className="mp-texte-doux">{resumeLigneDdPortail(p)}</p>
                </Carte>
              </li>
            );
          })}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant
              ? hrefPage(CHEMIN_DD_PORTAIL, r.donnees.curseur_suivant)
              : null
          }
          hrefDebut={curseur ? CHEMIN_DD_PORTAIL : null}
          libelle="Pages des notes de due diligence"
        />
      ) : null}
    </div>
  );
}

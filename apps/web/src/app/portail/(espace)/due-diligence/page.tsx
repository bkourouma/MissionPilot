import Link from "next/link";
import type { Metadata } from "next";
import type { PageDdPortail } from "@missionpilot/shared";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { hrefPage, lireCurseur, peut, requetePage } from "../../../../lib/portail";
import {
  AIDE_AUCUNE_NOTE,
  AIDE_AUCUNE_NOTE_EN,
  API_DD_PORTAIL,
  CHEMIN_DD_PORTAIL,
  etatRecommandationPortail,
  hrefDdPortail,
  MESSAGE_AUCUNE_NOTE,
  MESSAGE_AUCUNE_NOTE_EN,
  resumeLigneDdPortail,
  type DdPortailPublicationResume,
} from "../../../../lib/portail-dd";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Due diligence", "Due diligence") };
}

/** Notes de due diligence communiquées par le cabinet à l'investisseur, en lecture seule. */
export default async function DueDiligencePortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.dd.lire")) {
    return <NonDisponible titre={t("Due diligence", "Due diligence")} />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PageDdPortail<DdPortailPublicationResume>>(
    requetePage(API_DD_PORTAIL, curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Due diligence", "Due diligence")}
        soustitre={t(
          "Les notes validées que le cabinet vous a communiquées. Vous les consultez et téléchargez leurs documents ; vous ne pouvez rien modifier.",
          "The approved notes the firm has shared with you. You can view them and download their documents; you cannot change anything.",
        )}
        badges={
          <BadgeStatut tonalite="neutre" sansIcone>
            {t("Lecture seule", "Read-only")}
          </BadgeStatut>
        }
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La liste des notes n'a pas pu être chargée.",
            "The list of notes could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_DD_PORTAIL, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t(MESSAGE_AUCUNE_NOTE, MESSAGE_AUCUNE_NOTE_EN)} icone="livre">
          <p>{t(AIDE_AUCUNE_NOTE, AIDE_AUCUNE_NOTE_EN)}</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((p) => {
            const reco = etatRecommandationPortail(p.recommandation, langue);
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
                  <p className="mp-texte-doux">{resumeLigneDdPortail(p, langue)}</p>
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
          libelle={t("Pages des notes de due diligence", "Due diligence note pages")}
        />
      ) : null}
    </div>
  );
}

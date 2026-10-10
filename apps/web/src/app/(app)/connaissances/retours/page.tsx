import Link from "next/link";
import type { Metadata } from "next";
import { BoutonOuvrirRetour } from "../../../../components/connaissances/FormulairesConnaissances";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  cheminMissionsSansRetour,
  cheminRetours,
  hrefMissionsSansRetour,
  hrefRetours,
  lireCurseurRetours,
  tonaliteStatutRetour,
  type MissionSansRetour,
  type RetourResume,
} from "../../../../lib/capitalisation";
import { formaterDate } from "../../../../lib/format";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Retours d'expérience" };

/**
 * Retours d'expérience (CAP-01) des missions visibles : ouverts automatiquement à la clôture avec un
 * brouillon construit depuis les données de la mission, validés par le chef de mission puis
 * versés à la base de connaissances. Les missions clôturées avant cette ouverture automatique
 * sont listées à part : le retour s'y ouvre à la main (rattrapage).
 */
export default async function PageRetours({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("connaissance.lire");
  const params = await searchParams;
  const curseur = lireCurseurRetours(params.curseur);
  const curseurOuvrir = lireCurseurRetours(params.a_ouvrir);
  const [r, aOuvrir] = await Promise.all([
    chargerServeur<{ elements: RetourResume[]; curseur_suivant: string | null }>(
      cheminRetours(curseur),
    ),
    chargerServeur<{ elements: MissionSansRetour[]; curseur_suivant: string | null }>(
      cheminMissionsSansRetour(curseurOuvrir),
    ),
  ]);
  const sansRetour = aOuvrir.ok && aOuvrir.donnees.elements.length > 0 ? aOuvrir.donnees : null;
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre="Retours d'expérience"
        soustitre="Contexte, méthode, écarts et leçons de chaque mission terminée. Seuls les retours validés par le chef de mission entrent dans la base de connaissances."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les retours d'expérience n'ont pas pu être chargés."
          message={r.message}
          hrefReessayer={hrefRetours(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={curseur ? "Aucun autre retour." : "Aucun retour d'expérience."}>
          <p>
            Un retour d&apos;expérience s&apos;ouvre automatiquement à la clôture d&apos;une mission
            ; pour une mission clôturée avant cette fonction, ouvrez-le depuis la liste ci-dessous.
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {r.donnees.elements.map((x) => (
            <li key={x.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={`/connaissances/retours/${x.id}`}>
                  <strong>{x.mission_intitule}</strong>
                </Link>
                <span className="mp-texte-doux mp-texte-petit">
                  {x.client} · ouvert le {formaterDate(x.ouvert_le)}
                  {x.valide_le ? ` · validé le ${formaterDate(x.valide_le)}` : ""}
                </span>
              </div>
              <BadgeStatut tonalite={tonaliteStatutRetour(x.statut)}>
                {x.statut === "valide" ? "Validé" : "Brouillon"}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={r.donnees.curseur_suivant ? hrefRetours(r.donnees.curseur_suivant) : null}
          hrefDebut={curseur ? "/connaissances/retours" : null}
        />
      ) : null}
      {sansRetour ? (
        <Carte titre="Missions clôturées sans retour d'expérience" niveauTitre={2}>
          <p className="mp-texte-doux mp-texte-petit">
            Ces missions ont été clôturées avant l&apos;ouverture automatique du retour
            d&apos;expérience. Ouvrez-le pour en rédiger puis valider le contenu.
          </p>
          <ul className="mp-liste-lignes">
            {sansRetour.elements.map((x) => (
              <li key={x.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={`/missions/${x.mission_id}/bilan`}>
                    <strong>{x.mission_intitule}</strong>
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {x.client} · clôturée le {formaterDate(x.cloturee_le)}
                  </span>
                </div>
                {x.peut_ouvrir ? (
                  <BoutonOuvrirRetour missionId={x.mission_id} />
                ) : (
                  <span className="mp-texte-doux mp-texte-petit">
                    Réservé au chef, au directeur de la mission ou à un associé.
                  </span>
                )}
              </li>
            ))}
          </ul>
          <PaginationCurseur
            hrefSuivante={
              sansRetour.curseur_suivant ? hrefMissionsSansRetour(sansRetour.curseur_suivant) : null
            }
            hrefDebut={curseurOuvrir ? hrefMissionsSansRetour(null) : null}
          />
        </Carte>
      ) : null}
    </div>
  );
}

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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Retours d'expérience", "Lessons learned") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        titre={t("Retours d'expérience", "Lessons learned")}
        soustitre={t(
          "Contexte, méthode, écarts et leçons de chaque mission terminée. Seuls les retours validés par le chef de mission entrent dans la base de connaissances.",
          "Context, method, variances and lessons of each completed engagement. Only reviews approved by the engagement manager enter the knowledge base.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les retours d'expérience n'ont pas pu être chargés.",
            "The lessons-learned reviews could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefRetours(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            curseur
              ? t("Aucun autre retour.", "No other review.")
              : t("Aucun retour d'expérience.", "No lessons-learned review.")
          }
        >
          <p>
            {t(
              "Un retour d'expérience s'ouvre automatiquement à la clôture d'une mission ; pour une mission clôturée avant cette fonction, ouvrez-le depuis la liste ci-dessous.",
              "A lessons-learned review opens automatically when an engagement is closed; for an engagement closed before this feature, open it from the list below.",
            )}
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
                  {t(
                    `${x.client} · ouvert le ${formaterDate(x.ouvert_le)}`,
                    `${x.client} · opened on ${formaterDate(x.ouvert_le, "UTC", langue)}`,
                  )}
                  {x.valide_le
                    ? t(
                        ` · validé le ${formaterDate(x.valide_le)}`,
                        ` · approved on ${formaterDate(x.valide_le, "UTC", langue)}`,
                      )
                    : ""}
                </span>
              </div>
              <BadgeStatut tonalite={tonaliteStatutRetour(x.statut)}>
                {x.statut === "valide" ? t("Validé", "Approved") : t("Brouillon", "Draft")}
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
        <Carte
          titre={t(
            "Missions clôturées sans retour d'expérience",
            "Closed engagements without a lessons-learned review",
          )}
          niveauTitre={2}
        >
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Ces missions ont été clôturées avant l'ouverture automatique du retour d'expérience. Ouvrez-le pour en rédiger puis valider le contenu.",
              "These engagements were closed before lessons-learned reviews opened automatically. Open it to write and then approve its content.",
            )}
          </p>
          <ul className="mp-liste-lignes">
            {sansRetour.elements.map((x) => (
              <li key={x.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={`/missions/${x.mission_id}/bilan`}>
                    <strong>{x.mission_intitule}</strong>
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {t(
                      `${x.client} · clôturée le ${formaterDate(x.cloturee_le)}`,
                      `${x.client} · closed on ${formaterDate(x.cloturee_le, "UTC", langue)}`,
                    )}
                  </span>
                </div>
                {x.peut_ouvrir ? (
                  <BoutonOuvrirRetour missionId={x.mission_id} />
                ) : (
                  <span className="mp-texte-doux mp-texte-petit">
                    {t(
                      "Réservé au chef, au directeur de la mission ou à un associé.",
                      "Reserved for the engagement manager, the engagement director or a partner.",
                    )}
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

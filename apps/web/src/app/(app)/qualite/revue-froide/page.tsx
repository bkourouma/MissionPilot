import Link from "next/link";
import type { Metadata } from "next";
import "../../../../components/qualite/froide.css";
import "../../../../components/qualite/qualite.css";
import { FroideFormulaireTirage } from "../../../../components/qualite/FroideFormulaireTirage";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  cheminCampagnes,
  droitsQualiteFroide,
  formaterScore,
  HREF_MES_ACTIONS,
  HREF_REVUE_FROIDE,
  hrefCampagne,
  hrefEchantillon,
  libelleConclusion,
  libelleStatutCampagne,
  libelleStatutEchantillon,
  texteProgression,
  tonaliteConclusion,
  tonaliteStatutEchantillon,
  type PageCampagnes,
} from "../../../../lib/qualite-froide";
import {
  chargerDirecteurs,
  chargerMesRevues,
  chargerTypesPourTirage,
  exigerAccesFroide,
} from "../../../../lib/qualite-froide-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Revue à froid", "Cold review") };
}

const CURSEUR = /^[A-Za-z0-9_-]{1,500}$/;

/**
 * Revue à froid des missions clôturées (QUA-05) : l'associé tire un échantillon et suit les
 * campagnes ; le relecteur indépendant retrouve ses revues. Chaque section n'apparaît que pour
 * qui détient le droit correspondant ; l'API reste seule juge.
 */
export default async function PageRevueFroide({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await exigerAccesFroide();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const droits = droitsQualiteFroide(session.utilisateur.roles);
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const [campagnes, revues, types, directeurs] = await Promise.all([
    droits.gerer ? chargerServeur<PageCampagnes>(cheminCampagnes(curseur)) : null,
    droits.relire ? chargerMesRevues() : null,
    droits.gerer ? chargerTypesPourTirage(session) : [],
    droits.gerer ? chargerDirecteurs(session) : [],
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Revue à froid", "Cold review")}
        soustitre={t(
          "Un échantillon de missions clôturées est relu a posteriori par un relecteur indépendant, qui note huit critères et consigne ses constats ; l'associé en tire un plan d'amélioration.",
          "A sample of closed engagements is reviewed after the fact by an independent reviewer, who scores eight criteria and records findings; the partner derives an improvement plan from them.",
        )}
        retour={{ href: "/qualite", libelle: t("Qualité", "Quality") }}
        actions={
          <Link href={HREF_MES_ACTIONS} className="mp-lien-ligne">
            {t("Mes actions d'amélioration", "My improvement actions")}
          </Link>
        }
      />

      {droits.relire ? (
        <section aria-labelledby="titre-mes-revues" className="mp-froide__pile">
          <h2 id="titre-mes-revues" className="mp-section__titre">
            {t("Mes revues", "My reviews")}
          </h2>
          {!revues || !revues.ok ? (
            <EtatErreur
              titre={t(
                "Vos revues n'ont pas pu être chargées.",
                "Your reviews could not be loaded.",
              )}
              message={
                revues && !revues.ok
                  ? revues.message
                  : t("Réponse indisponible.", "Response unavailable.")
              }
              hrefReessayer={HREF_REVUE_FROIDE}
            />
          ) : revues.donnees.elements.length === 0 ? (
            <EtatVide
              titre={t("Aucune revue ne vous est affectée.", "No review is assigned to you.")}
              icone="signature"
            >
              <p>
                {t(
                  "Lorsqu'un associé vous désignera relecteur indépendant d'une mission clôturée, elle apparaîtra ici.",
                  "When a partner appoints you as independent reviewer of a closed engagement, it will appear here.",
                )}
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-lignes">
              {revues.donnees.elements.map((r) => (
                <li key={r.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <Link href={hrefEchantillon(r.id)} className="mp-lien-ligne">
                      {r.mission_intitule}
                    </Link>
                    <span className="mp-texte-doux mp-texte-petit">
                      {r.client_nom} · {t("campagne", "campaign")} {r.campagne_intitule}
                    </span>
                    <span className="mp-texte-doux mp-texte-petit">
                      {texteProgression(
                        r.criteres_evalues,
                        r.criteres_total,
                        t("critères évalués", "criteria assessed"),
                        langue,
                      )}
                      {r.terminee_le
                        ? t(
                            ` · terminée le ${formaterDate(r.terminee_le, "UTC", langue)}`,
                            ` · completed on ${formaterDate(r.terminee_le, "UTC", langue)}`,
                          )
                        : ""}
                      {r.conclusion ? ` · ${formaterScore(r.score, langue)}` : ""}
                    </span>
                  </div>
                  <BadgeStatut tonalite={tonaliteStatutEchantillon(r.statut)}>
                    {libelleStatutEchantillon(r.statut, langue)}
                  </BadgeStatut>
                  {r.conclusion ? (
                    <BadgeStatut tonalite={tonaliteConclusion(r.conclusion)}>
                      {libelleConclusion(r.conclusion, langue)}
                    </BadgeStatut>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {revues && revues.ok && revues.donnees.tronquee ? (
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "La liste est partielle : seules les revues les plus récentes sont affichées.",
                "The list is partial: only the most recent reviews are shown.",
              )}
            </p>
          ) : null}
        </section>
      ) : null}

      {droits.gerer ? (
        <>
          <Carte titre={t("Tirer un échantillon", "Draw a sample")}>
            <FroideFormulaireTirage types={types} directeurs={directeurs} />
          </Carte>

          <section aria-labelledby="titre-campagnes" className="mp-froide__pile">
            <h2 id="titre-campagnes" className="mp-section__titre">
              {t("Campagnes de revue", "Review campaigns")}
            </h2>
            {!campagnes || !campagnes.ok ? (
              <EtatErreur
                titre={t(
                  "Les campagnes n'ont pas pu être chargées.",
                  "The campaigns could not be loaded.",
                )}
                message={
                  campagnes && !campagnes.ok
                    ? campagnes.message
                    : t("Réponse indisponible.", "Response unavailable.")
                }
                hrefReessayer={HREF_REVUE_FROIDE}
              />
            ) : campagnes.donnees.elements.length === 0 ? (
              <EtatVide
                titre={
                  curseur
                    ? t("Aucune autre campagne.", "No more campaigns.")
                    : t("Aucune campagne de revue.", "No review campaign.")
                }
                icone="signature"
              >
                <p>
                  {t(
                    "Tirez un premier échantillon ci-dessus pour ouvrir une campagne.",
                    "Draw a first sample above to open a campaign.",
                  )}
                </p>
              </EtatVide>
            ) : (
              <ul className="mp-liste-lignes">
                {campagnes.donnees.elements.map((c) => (
                  <li key={c.id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <Link href={hrefCampagne(c.id)} className="mp-lien-ligne">
                        {c.intitule}
                      </Link>
                      <span className="mp-texte-doux mp-texte-petit">
                        {t("Créée le", "Created on")} {formaterDate(c.cree_le, "UTC", langue)} ·{" "}
                        {texteProgression(
                          c.terminees,
                          c.taille_obtenue,
                          t("revues terminées", "reviews completed"),
                          langue,
                        )}
                        {c.taille_obtenue < c.taille_demandee
                          ? t(
                              ` · ${c.taille_obtenue} mission(s) tirée(s) sur ${c.taille_demandee} demandée(s)`,
                              ` · ${c.taille_obtenue} engagement(s) drawn out of ${c.taille_demandee} requested`,
                            )
                          : ""}
                      </span>
                    </div>
                    <BadgeStatut tonalite={c.statut === "ouverte" ? "attention" : "neutre"}>
                      {libelleStatutCampagne(c.statut, langue)}
                    </BadgeStatut>
                  </li>
                ))}
              </ul>
            )}
            {campagnes && campagnes.ok ? (
              <PaginationCurseur
                hrefSuivante={
                  campagnes.donnees.curseur_suivant
                    ? `${HREF_REVUE_FROIDE}?curseur=${encodeURIComponent(campagnes.donnees.curseur_suivant)}`
                    : null
                }
                hrefDebut={curseur ? HREF_REVUE_FROIDE : null}
              />
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

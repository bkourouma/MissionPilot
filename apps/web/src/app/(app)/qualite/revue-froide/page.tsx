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

export const metadata: Metadata = { title: "Revue à froid" };

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
        titre="Revue à froid"
        soustitre="Un échantillon de missions clôturées est relu a posteriori par un relecteur indépendant, qui note huit critères et consigne ses constats ; l'associé en tire un plan d'amélioration."
        retour={{ href: "/qualite", libelle: "Qualité" }}
        actions={
          <Link href={HREF_MES_ACTIONS} className="mp-lien-ligne">
            Mes actions d&apos;amélioration
          </Link>
        }
      />

      {droits.relire ? (
        <section aria-labelledby="titre-mes-revues" className="mp-froide__pile">
          <h2 id="titre-mes-revues" className="mp-section__titre">
            Mes revues
          </h2>
          {!revues || !revues.ok ? (
            <EtatErreur
              titre="Vos revues n'ont pas pu être chargées."
              message={revues && !revues.ok ? revues.message : "Réponse indisponible."}
              hrefReessayer={HREF_REVUE_FROIDE}
            />
          ) : revues.donnees.elements.length === 0 ? (
            <EtatVide titre="Aucune revue ne vous est affectée." icone="signature">
              <p>
                Lorsqu&apos;un associé vous désignera relecteur indépendant d&apos;une mission
                clôturée, elle apparaîtra ici.
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
                      {r.client_nom} · campagne {r.campagne_intitule}
                    </span>
                    <span className="mp-texte-doux mp-texte-petit">
                      {texteProgression(r.criteres_evalues, r.criteres_total, "critères évalués")}
                      {r.terminee_le ? ` · terminée le ${formaterDate(r.terminee_le)}` : ""}
                      {r.conclusion ? ` · ${formaterScore(r.score)}` : ""}
                    </span>
                  </div>
                  <BadgeStatut tonalite={tonaliteStatutEchantillon(r.statut)}>
                    {libelleStatutEchantillon(r.statut)}
                  </BadgeStatut>
                  {r.conclusion ? (
                    <BadgeStatut tonalite={tonaliteConclusion(r.conclusion)}>
                      {libelleConclusion(r.conclusion)}
                    </BadgeStatut>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {revues && revues.ok && revues.donnees.tronquee ? (
            <p className="mp-texte-doux mp-texte-petit">
              La liste est partielle : seules les revues les plus récentes sont affichées.
            </p>
          ) : null}
        </section>
      ) : null}

      {droits.gerer ? (
        <>
          <Carte titre="Tirer un échantillon">
            <FroideFormulaireTirage types={types} directeurs={directeurs} />
          </Carte>

          <section aria-labelledby="titre-campagnes" className="mp-froide__pile">
            <h2 id="titre-campagnes" className="mp-section__titre">
              Campagnes de revue
            </h2>
            {!campagnes || !campagnes.ok ? (
              <EtatErreur
                titre="Les campagnes n'ont pas pu être chargées."
                message={campagnes && !campagnes.ok ? campagnes.message : "Réponse indisponible."}
                hrefReessayer={HREF_REVUE_FROIDE}
              />
            ) : campagnes.donnees.elements.length === 0 ? (
              <EtatVide
                titre={curseur ? "Aucune autre campagne." : "Aucune campagne de revue."}
                icone="signature"
              >
                <p>Tirez un premier échantillon ci-dessus pour ouvrir une campagne.</p>
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
                        Créée le {formaterDate(c.cree_le)} ·{" "}
                        {texteProgression(c.terminees, c.taille_obtenue, "revues terminées")}
                        {c.taille_obtenue < c.taille_demandee
                          ? ` · ${c.taille_obtenue} mission(s) tirée(s) sur ${c.taille_demandee} demandée(s)`
                          : ""}
                      </span>
                    </div>
                    <BadgeStatut tonalite={c.statut === "ouverte" ? "attention" : "neutre"}>
                      {libelleStatutCampagne(c.statut)}
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

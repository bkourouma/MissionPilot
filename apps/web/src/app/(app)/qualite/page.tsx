import Link from "next/link";
import type { Metadata } from "next";
import "../../../components/qualite/qualite.css";
import { FormulaireOuvertureSuivi } from "../../../components/qualite/FormulaireOuvertureSuivi";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { formaterDate } from "../../../lib/format";
import type { Mission } from "../../../lib/missions";
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../lib/pagination";
import {
  cheminSuivis,
  droitsQualite,
  hrefQualite,
  hrefSuivi,
  libelleClasse,
  libelleStatutSuivi,
  libelleType,
  lireFiltresQualite,
  texteParcours,
  tonaliteClasse,
  tonaliteStatutSuivi,
  type PageSuivis,
} from "../../../lib/qualite";
import { droitsQualiteFroide, HREF_REVUE_FROIDE } from "../../../lib/qualite-froide";
import { exigerConsultationQualite } from "../../../lib/qualite-serveur";
import { STATUTS_SUIVI } from "@missionpilot/shared";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Qualité des livrables", "Deliverable quality") };
}

/**
 * Tableau des livrables suivis (QUA-01 à QUA-04, QUA-06) : classe de risque, statut, progression
 * du parcours de revue de l'utilisateur. L'ouverture d'un suivi est réservée à qui relit
 * (`qualite.relire`) ; l'API ne montre que les livrables des missions visibles.
 */
export default async function PageQualite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await exigerConsultationQualite();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const droits = droitsQualite(session.utilisateur.roles);
  const froide = droitsQualiteFroide(session.utilisateur.roles);
  const filtres = lireFiltresQualite(await searchParams);
  const [r, missions] = await Promise.all([
    chargerServeur<PageSuivis>(cheminSuivis(filtres)),
    droits.relire
      ? chargerToutesLesPages<Mission>(chargerServeur, "/api/missions", {
          limiteMax: LIMITE_PAGE_MAX,
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Qualité des livrables", "Deliverable quality")}
        soustitre={t(
          "Classe de risque, revue guidée, quatre yeux et signature : plus l'IA produit, plus la relecture humaine doit être exigeante.",
          "Risk class, guided review, four eyes and signature: the more AI produces, the more demanding human review must be.",
        )}
        actions={
          droits.relire || froide.acces ? (
            <>
              {droits.relire ? (
                <>
                  <Link href="/qualite/acceptation" className="mp-lien-ligne">
                    {t("Acceptation de mission", "Engagement acceptance")}
                  </Link>
                  <Link href="/qualite/satisfaction" className="mp-lien-ligne">
                    {t("Satisfaction des clients", "Client satisfaction")}
                  </Link>
                </>
              ) : null}
              {froide.acces ? (
                <Link href={HREF_REVUE_FROIDE} className="mp-lien-ligne">
                  {t("Revue à froid", "Cold review")}
                </Link>
              ) : null}
            </>
          ) : undefined
        }
      />

      {droits.relire ? (
        <Carte titre={t("Ouvrir le suivi d'un livrable", "Open a deliverable's follow-up")}>
          {missions && missions.ok ? (
            <FormulaireOuvertureSuivi
              missions={missions.donnees.elements.map((m) => ({ id: m.id, intitule: m.intitule }))}
            />
          ) : (
            <EtatErreur
              titre={t(
                "La liste des missions n'a pas pu être chargée.",
                "The list of engagements could not be loaded.",
              )}
              message={
                missions && !missions.ok
                  ? missions.message
                  : t(
                      "Réessayez pour pouvoir ouvrir un suivi.",
                      "Try again to be able to open a follow-up.",
                    )
              }
              hrefReessayer={hrefQualite(filtres)}
            />
          )}
        </Carte>
      ) : null}

      <section aria-labelledby="titre-suivis" className="mp-pile">
        <h2 id="titre-suivis" className="mp-section__titre">
          {filtres.mission
            ? t("Livrables suivis de la mission", "Tracked deliverables of the engagement")
            : t("Livrables suivis", "Tracked deliverables")}
        </h2>
        {filtres.mission ? (
          <p className="mp-texte-doux mp-texte-petit">
            <Link href={`/missions/${filtres.mission}`} className="mp-lien-ligne">
              {t("Retour à la mission", "Back to the engagement")}
            </Link>{" "}
            ·{" "}
            <Link href={hrefQualite({ statut: filtres.statut })} className="mp-lien-ligne">
              {t("Toutes les missions", "All engagements")}
            </Link>
          </p>
        ) : null}
        <nav
          className="mp-qualite__entete-liste"
          aria-label={t("Filtrer par statut", "Filter by status")}
        >
          <Link
            href={hrefQualite({ mission: filtres.mission })}
            className="mp-qualite__filtre"
            aria-current={filtres.statut === "" ? "true" : undefined}
          >
            {t("Tous", "All")}
          </Link>
          {STATUTS_SUIVI.map((s) => (
            <Link
              key={s}
              href={hrefQualite({ mission: filtres.mission, statut: s })}
              className="mp-qualite__filtre"
              aria-current={filtres.statut === s ? "true" : undefined}
            >
              {libelleStatutSuivi(s, langue)}
            </Link>
          ))}
        </nav>

        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les livrables n'ont pas pu être chargés.",
              "The deliverables could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={hrefQualite(filtres)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={
              filtres.curseur
                ? t("Aucun autre livrable.", "No more deliverables.")
                : t("Aucun livrable suivi.", "No tracked deliverables.")
            }
            icone="signature"
          >
            <p>
              {droits.relire
                ? t(
                    "Ouvrez le suivi d'un livrable ci-dessus : sa classe de risque fixe la garde à franchir.",
                    "Open a deliverable's follow-up above: its risk class sets the safeguard to complete.",
                  )
                : t(
                    "Les livrables de vos missions apparaîtront ici dès l'ouverture de leur suivi qualité.",
                    "The deliverables of your engagements will appear here once their quality follow-up is opened.",
                  )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {r.donnees.elements.map((s) => (
              <li key={s.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefSuivi(s.id)} className="mp-lien-ligne">
                    {s.libelle}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {libelleType(s.type_livrable, langue)} · {t("version", "version")} {s.version} ·{" "}
                    {s.mission_intitule} · {t("ouvert le", "opened on")}{" "}
                    {formaterDate(s.ouvert_le, "UTC", langue)}
                  </span>
                  <span className="mp-texte-doux mp-texte-petit">
                    {texteParcours(
                      {
                        obligatoires: s.elements_obligatoires,
                        vus: s.elements_vus_par_moi,
                        restants: s.elements_obligatoires - s.elements_vus_par_moi,
                        complet: s.elements_vus_par_moi >= s.elements_obligatoires,
                      },
                      langue,
                    )}{" "}
                    ·{" "}
                    {t(
                      `${s.validations_faites} validation(s)`,
                      `${s.validations_faites} approval(s)`,
                    )}
                  </span>
                </div>
                <BadgeStatut tonalite={tonaliteClasse(s.classe)}>
                  {libelleClasse(s.classe, langue)}
                </BadgeStatut>
                <BadgeStatut tonalite={tonaliteStatutSuivi(s.statut)}>
                  {libelleStatutSuivi(s.statut, langue)}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefQualite({ ...filtres, curseur: r.donnees.curseur_suivant })
                : null
            }
            hrefDebut={
              filtres.curseur
                ? hrefQualite({ mission: filtres.mission, statut: filtres.statut })
                : null
            }
          />
        ) : null}
      </section>
    </div>
  );
}

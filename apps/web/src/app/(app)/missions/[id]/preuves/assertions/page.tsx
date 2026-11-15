import Link from "next/link";
import type { Metadata } from "next";
import { CLASSES_RISQUE, STATUTS_ASSERTION as STATUTS } from "@missionpilot/shared";
import { BadgeSolidite } from "../../../../../../components/preuves/BadgeSolidite";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { Champ } from "../../../../../../components/ui/Champ";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../components/ui/Icone";
import { Select } from "../../../../../../components/ui/Select";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  cheminControle,
  droitsPreuves,
  hrefAssertion,
  hrefAssertions,
  hrefAssertionsFiltre,
  hrefNouvelleAssertion,
  libelleAnomalie,
  libelleClasseRisque,
  libelleStatutAssertion,
  lireParametresAssertions,
  requeteAssertions,
  type ControleLivrableVue,
  type ElementAssertion,
  type PageApi,
} from "../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Assertions", "Assertions") };
}

/**
 * Assertions de la mission (PRV-02, PRV-03) : conclusions à écrire dans un livrable, avec leur
 * indice de solidité calculé par le moteur, et contrôle des livrables de classe R2 et R3 (preuve
 * ou avis d'expert signé).
 */
export default async function PageAssertions({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("preuve.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const droits = droitsPreuves(utilisateur.roles, r.donnees);
  const p = lireParametresAssertions(await searchParams);
  const [page, controle] = await Promise.all([
    chargerServeur<PageApi<ElementAssertion>>(
      `/api/missions/${id}/assertions?${requeteAssertions(p)}`,
    ),
    chargerServeur<ControleLivrableVue>(cheminControle(id)),
  ]);
  const filtre = Boolean(p.q ?? p.statut ?? p.classe_risque);

  return (
    <>
      {controle.ok ? (
        controle.donnees.conforme ? (
          <Alerte
            tonalite="succes"
            titre={t("Contrôle des livrables R2 et R3", "R2 and R3 deliverable check")}
            annonce="aucune"
          >
            <p>
              {controle.donnees.controlees === 0
                ? t(
                    "Aucune assertion de classe R2 ou R3 à contrôler pour le moment.",
                    "No R2 or R3 assertion to check for now.",
                  )
                : t(
                    `Les ${controle.donnees.controlees} assertion(s) R2 et R3 reposent sur une preuve ou sur un avis d'expert signé.`,
                    `The ${controle.donnees.controlees} R2 and R3 assertion(s) rest on evidence or on a signed expert opinion.`,
                  )}
            </p>
          </Alerte>
        ) : (
          <Alerte
            tonalite="attention"
            titre={t("Contrôle des livrables R2 et R3", "R2 and R3 deliverable check")}
            annonce="aucune"
          >
            <p>
              {t(
                `${controle.donnees.anomalies.length} assertion(s) R2 ou R3 ne reposent ni sur une preuve ni sur un avis d'expert signé : elles ne peuvent pas partir dans un livrable.`,
                `${controle.donnees.anomalies.length} R2 or R3 assertion(s) rest neither on evidence nor on a signed expert opinion: they cannot go into a deliverable.`,
              )}
            </p>
            <ul className="mp-liste-simple">
              {controle.donnees.anomalies.map((a) => (
                <li key={a.assertion_id}>
                  <Link href={hrefAssertion(id, a.assertion_id)}>{a.enonce}</Link>
                  {` · ${a.classe_risque} · ${libelleAnomalie(a.code, langue)}`}
                </li>
              ))}
            </ul>
          </Alerte>
        )
      ) : (
        <Alerte
          tonalite="attention"
          titre={t("Contrôle des livrables indisponible", "Deliverable check unavailable")}
          annonce="aucune"
        >
          <p>{controle.message}</p>
        </Alerte>
      )}

      {droits.ecrire ? (
        <div>
          <Link href={hrefNouvelleAssertion(id)} className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>{t("Nouvelle assertion", "New assertion")}</span>
          </Link>
        </div>
      ) : null}

      <form
        method="get"
        action={hrefAssertions(id)}
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer les assertions", "Filter the assertions")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle={t("Rechercher", "Search")}
            type="search"
            name="q"
            maxLength={100}
            defaultValue={p.q}
            autoComplete="off"
          />
          <Select
            libelle={t("Statut", "Status")}
            name="statut"
            invite={t("Tous", "All")}
            options={STATUTS.map((s) => ({
              valeur: s,
              libelle: libelleStatutAssertion(s, langue),
            }))}
            defaultValue={p.statut}
          />
          <Select
            libelle={t("Classe de risque", "Risk class")}
            name="classe_risque"
            invite={t("Toutes", "All")}
            options={CLASSES_RISQUE.map((c) => ({
              valeur: c,
              libelle: libelleClasseRisque(c, langue),
            }))}
            defaultValue={p.classe_risque}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("secondaire")}>
            <Icone nom="recherche" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
        </div>
      </form>

      {!page.ok ? (
        <EtatErreur
          titre={t(
            "Les assertions n'ont pas pu être chargées.",
            "The assertions could not be loaded.",
          )}
          message={page.message}
          hrefReessayer={hrefAssertionsFiltre(id, p, p.curseur ?? null)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t("Aucune assertion ne correspond.", "No assertion matches.")
              : t("Aucune assertion enregistrée.", "No assertion recorded.")
          }
          icone="bulle"
        >
          <p>
            {filtre
              ? t(
                  "Élargissez les filtres pour revoir toutes les assertions.",
                  "Widen the filters to see all the assertions again.",
                )
              : droits.ecrire
                ? t(
                    "Formulez les conclusions que vous voulez écrire dans un livrable, puis reliez-les à leurs preuves.",
                    "Write the conclusions you want to put in a deliverable, then link them to their evidence.",
                  )
                : t(
                    "Les assertions de la mission apparaîtront ici dès qu'un consultant les aura formulées.",
                    "The engagement's assertions will appear here as soon as a consultant has written them.",
                  )}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul
            className="mp-preuves-liste"
            aria-label={t("Assertions de la mission", "Engagement assertions")}
          >
            {page.donnees.elements.map((a) => (
              <li key={a.id} className="mp-preuve-ligne">
                <h3 className="mp-preuve-ligne__titre">
                  <Link href={hrefAssertion(id, a.id)}>{a.enonce}</Link>
                </h3>
                <span className="mp-preuve-ligne__meta">
                  <BadgeSolidite solidite={a.solidite} />
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleClasseRisque(a.classe_risque, langue)}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleStatutAssertion(a.statut, langue)}
                  </BadgeStatut>
                  {a.avis_expert ? (
                    <BadgeStatut tonalite={a.avis_expert.signe ? "succes" : "attention"}>
                      {a.avis_expert.signe
                        ? t("Avis d'expert signé", "Signed expert opinion")
                        : t("Avis d'expert non signé", "Unsigned expert opinion")}
                    </BadgeStatut>
                  ) : null}
                  {a.a_arbitrer > 0 ? (
                    <BadgeStatut tonalite="danger">
                      {t(
                        `${a.a_arbitrer} contradiction(s) à arbitrer`,
                        `${a.a_arbitrer} contradiction(s) to arbitrate`,
                      )}
                    </BadgeStatut>
                  ) : null}
                </span>
                {a.livrable ? (
                  <p className="mp-texte-doux mp-texte-petit">
                    {t("Livrable", "Deliverable")} : {a.livrable}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <PaginationCurseur
            libelle={t("Pagination des assertions", "Assertions pagination")}
            hrefSuivante={
              page.donnees.curseur_suivant
                ? hrefAssertionsFiltre(id, p, page.donnees.curseur_suivant)
                : null
            }
            hrefDebut={p.curseur ? hrefAssertionsFiltre(id, p, null) : null}
          />
        </>
      )}
      <Carte titre={t("Comment lire l'indice", "How to read the index")}>
        <p className="mp-texte-doux">
          {t(
            "Pour chaque type de source indépendant (questionnaire, entretien, observation, document, donnée externe), la meilleure fiabilité est retenue ; la somme est plafonnée puis ramenée entre 0 et 1. Une contradiction non arbitrée divise l'indice par deux. Ces valeurs sont calculées par le moteur de CabinetPilot et à calibrer au pilote.",
            "For each independent source type (questionnaire, interview, observation, document, external data), the best reliability is kept; the sum is capped then scaled between 0 and 1. An unarbitrated contradiction halves the index. These values are computed by the CabinetPilot engine and are to be calibrated during the pilot.",
          )}
        </p>
      </Carte>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/qualite/froide.css";
import "../../../../../components/qualite/qualite.css";
import { FroideClotureCampagne } from "../../../../../components/qualite/FroideClotureCampagne";
import { FroideAffectation } from "../../../../../components/qualite/FroideAffectation";
import { FroideListeActions } from "../../../../../components/qualite/FroideListeActions";
import { FroidePlanFormulaire } from "../../../../../components/qualite/FroidePlanFormulaire";
import { FroideVerification } from "../../../../../components/qualite/FroideVerification";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau, type ColonneTableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { empreinteCourte } from "../../../../../lib/qualite";
import {
  cheminCampagne,
  cheminPlan,
  estUuid,
  formaterScore,
  formaterTauxRealisation,
  HREF_REVUE_FROIDE,
  hrefCampagne,
  hrefEchantillon,
  libelleConclusion,
  libelleStatutCampagne,
  libelleStatutEchantillon,
  libelleStrate,
  texteProgression,
  tonaliteConclusion,
  tonaliteStatutEchantillon,
  type CampagneDetail,
  type LigneEchantillon,
  type PlanAmelioration,
} from "../../../../../lib/qualite-froide";
import {
  chargerConstatsCampagne,
  chargerDirecteurs,
  chargerResponsables,
  chargerTypesPourTirage,
  exigerGestionFroide,
} from "../../../../../lib/qualite-froide-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Campagne de revue à froid", "Cold review campaign") };
}

/**
 * Détail d'une campagne de revue à froid (associé) : paramètres du tirage et sa vérification,
 * échantillon et affectation des relecteurs indépendants, clôture, puis plan d'amélioration.
 */
export default async function PageCampagneFroide({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerGestionFroide();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const d = (v: string | null | undefined) => formaterDate(v, "UTC", langue);
  const { id } = await params;
  if (!estUuid(id)) notFound();
  const [r, plan] = await Promise.all([
    chargerServeur<CampagneDetail>(cheminCampagne(id)),
    chargerServeur<PlanAmelioration>(cheminPlan(id)),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Campagne de revue à froid", "Cold review campaign")}
          retour={{ href: HREF_REVUE_FROIDE, libelle: t("Revue à froid", "Cold review") }}
        />
        <EtatErreur
          titre={t("La campagne n'a pas pu être chargée.", "The campaign could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefCampagne(id)}
        />
      </div>
    );
  }
  const c = r.donnees;
  const [responsables, types, directeurs, constats] = await Promise.all([
    chargerResponsables(session),
    chargerTypesPourTirage(session),
    chargerDirecteurs(session),
    chargerConstatsCampagne(c.echantillon, langue),
  ]);
  const noms = (ids: string[], options: { valeur: string; libelle: string }[]) =>
    ids.length === 0
      ? t("Tous", "All")
      : ids
          .map((x) => options.find((o) => o.valeur === x)?.libelle ?? t("Non listé", "Not listed"))
          .join(", ");
  const ouverte = c.statut === "ouverte";

  const colonnes: ColonneTableau<LigneEchantillon>[] = [
    {
      cle: "mission",
      entete: t("Mission", "Engagement"),
      rendu: (l) => (
        <Link href={hrefEchantillon(l.id)} className="mp-lien-ligne">
          {l.mission_intitule}
        </Link>
      ),
    },
    { cle: "client_nom", entete: t("Client", "Client") },
    { cle: "directeur_nom", entete: t("Directeur", "Director") },
    {
      cle: "mission_cloturee_le",
      entete: t("Clôture", "Close-out"),
      rendu: (l) => d(l.mission_cloturee_le),
    },
    {
      cle: "relecteur",
      entete: t("Relecteur", "Reviewer"),
      rendu: (l) =>
        l.relecteur_nom ??
        (ouverte && l.statut === "a_affecter" ? (
          <FroideAffectation echantillonId={l.id} mission={l.mission_intitule} />
        ) : (
          "—"
        )),
    },
    {
      cle: "statut",
      entete: t("Statut", "Status"),
      rendu: (l) => (
        <BadgeStatut tonalite={tonaliteStatutEchantillon(l.statut)}>
          {libelleStatutEchantillon(l.statut, langue)}
        </BadgeStatut>
      ),
    },
    {
      cle: "resultat",
      entete: t("Score et conclusion", "Score and conclusion"),
      rendu: (l) =>
        l.conclusion ? (
          <>
            {formaterScore(l.score, langue)}{" "}
            <BadgeStatut tonalite={tonaliteConclusion(l.conclusion)}>
              {libelleConclusion(l.conclusion, langue)}
            </BadgeStatut>
          </>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={c.intitule}
        soustitre={`${t("Créée le", "Created on")} ${d(c.cree_le)}${c.cree_par_nom ? ` ${t("par", "by")} ${c.cree_par_nom}` : ""} · ${texteProgression(c.progression.terminees, c.progression.total, t("revues terminées", "reviews completed"), langue)}`}
        retour={{ href: HREF_REVUE_FROIDE, libelle: t("Revue à froid", "Cold review") }}
        badges={
          <BadgeStatut tonalite={ouverte ? "attention" : "neutre"}>
            {libelleStatutCampagne(c.statut, langue)}
          </BadgeStatut>
        }
      />

      <Carte titre={t("Tirage de l'échantillon", "Sample draw")}>
        <div className="mp-froide__pile">
          <dl className="mp-froide__def">
            <dt>{t("Période de clôture", "Close-out period")}</dt>
            <dd>
              {t(
                `du ${d(c.criteres.periode_debut)} au ${d(c.criteres.periode_fin)}`,
                `from ${d(c.criteres.periode_debut)} to ${d(c.criteres.periode_fin)}`,
              )}
            </dd>
            <dt>{t("Types de mission", "Engagement types")}</dt>
            <dd>{noms(c.criteres.types_mission_ids, types)}</dd>
            <dt>{t("Directeurs", "Directors")}</dt>
            <dd>{noms(c.criteres.directeur_ids, directeurs)}</dd>
            <dt>{t("Stratification", "Stratification")}</dt>
            <dd>
              {c.criteres.stratifier_par
                ? libelleStrate(c.criteres.stratifier_par, langue)
                : t("Aucune", "None")}
            </dd>
            <dt>{t("Missions déjà revues", "Engagements already reviewed")}</dt>
            <dd>
              {c.criteres.exclure_deja_revues
                ? t("Exclues du tirage", "Excluded from the draw")
                : t("Incluses dans le tirage", "Included in the draw")}
            </dd>
            <dt>{t("Taille", "Size")}</dt>
            <dd>
              {t(
                `${c.taille_obtenue} mission(s) tirée(s) sur ${c.taille_demandee} demandée(s)`,
                `${c.taille_obtenue} engagement(s) drawn out of ${c.taille_demandee} requested`,
              )}
            </dd>
            <dt>{t("Population tirable", "Eligible population")}</dt>
            <dd>
              {t(
                `${c.population_taille} mission(s) clôturée(s)`,
                `${c.population_taille} closed engagement(s)`,
              )}
            </dd>
            <dt>{t("Graine", "Seed")}</dt>
            <dd>{c.graine}</dd>
            <dt>{t("Empreinte de la population", "Population fingerprint")}</dt>
            <dd title={c.empreinte_population}>{empreinteCourte(c.empreinte_population)}</dd>
          </dl>
          <FroideVerification campagneId={c.id} />
        </div>
      </Carte>

      <section
        aria-labelledby="titre-echantillon"
        className="mp-froide__pile mp-froide__echantillon"
      >
        <h2 id="titre-echantillon" className="mp-section__titre">
          {t("Échantillon", "Sample")}
        </h2>
        <Tableau
          legende={t("Échantillon de la campagne", "Campaign sample")}
          colonnes={colonnes}
          lignes={c.echantillon}
          cleLigne={(l) => l.id}
          messageVide={t(
            "Aucune mission n'a été tirée : la population ne contenait aucune mission clôturée correspondant aux critères.",
            "No engagement was drawn: the population contained no closed engagement matching the criteria.",
          )}
        />
      </section>

      {ouverte ? (
        <Carte titre={t("Clôture de la campagne", "Campaign close-out")}>
          <div className="mp-froide__pile">
            <p>
              {t(
                "La campagne peut être close lorsque toutes les revues sont terminées",
                "The campaign can be closed once all reviews are completed",
              )}{" "}
              (
              {texteProgression(
                c.progression.terminees,
                c.progression.total,
                t("terminées", "completed"),
                langue,
              )}
              ).
            </p>
            <FroideClotureCampagne campagneId={c.id} />
          </div>
        </Carte>
      ) : (
        <p className="mp-texte-doux">
          {t(`Campagne close le ${d(c.cloturee_le)}.`, `Campaign closed on ${d(c.cloturee_le)}.`)}
        </p>
      )}

      <section aria-labelledby="titre-plan" className="mp-froide__pile">
        <h2 id="titre-plan" className="mp-section__titre">
          {t("Plan d'amélioration", "Improvement plan")}
        </h2>
        {!plan.ok ? (
          <EtatErreur
            titre={t("Le plan n'a pas pu être chargé.", "The plan could not be loaded.")}
            message={plan.message}
            hrefReessayer={hrefCampagne(id)}
          />
        ) : (
          <>
            <ul
              className="mp-froide__indicateurs"
              aria-label={t(
                "Indicateurs du plan, calculés par le moteur",
                "Plan indicators, computed by the engine",
              )}
            >
              <li className="mp-froide__indicateur">
                <strong>
                  {formaterTauxRealisation(plan.donnees.etat.taux_realisation, langue)}
                </strong>
                <span>
                  {t(
                    `réalisation (${plan.donnees.etat.faites} faite(s) sur ${plan.donnees.etat.total})`,
                    `completion (${plan.donnees.etat.faites} done out of ${plan.donnees.etat.total})`,
                  )}
                </span>
              </li>
              <li className="mp-froide__indicateur">
                <strong>{plan.donnees.etat.en_retard}</strong>
                <span>{t("en retard", "overdue")}</span>
              </li>
              <li className="mp-froide__indicateur">
                <strong>{plan.donnees.etat.en_cours}</strong>
                <span>
                  {t(
                    `en cours (${plan.donnees.etat.a_faire} à faire)`,
                    `in progress (${plan.donnees.etat.a_faire} to do)`,
                  )}
                </span>
              </li>
              <li className="mp-froide__indicateur">
                <strong>{d(plan.donnees.etat.prochaine_echeance)}</strong>
                <span>{t("prochaine échéance", "next due date")}</span>
              </li>
            </ul>
            {plan.donnees.actions.length === 0 ? (
              <EtatVide
                titre={t(
                  "Aucune action au plan d'amélioration.",
                  "No action in the improvement plan.",
                )}
                icone="signature"
              >
                <p>
                  {t(
                    "Ajoutez une action à partir d'un constat ou librement.",
                    "Add an action from a finding or freely.",
                  )}
                </p>
              </EtatVide>
            ) : (
              <FroideListeActions
                actions={plan.donnees.actions}
                utilisateurId={session.utilisateur.id}
                peutGerer
                responsables={responsables}
              />
            )}
          </>
        )}
        <Carte titre={t("Ajouter une action", "Add an action")} niveauTitre={3}>
          <FroidePlanFormulaire campagneId={c.id} responsables={responsables} constats={constats} />
        </Carte>
      </section>
    </div>
  );
}

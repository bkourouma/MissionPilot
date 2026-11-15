import Link from "next/link";
import type { Metadata } from "next";
import { aPermission, creerTraduire, type Langue } from "@missionpilot/shared";
import { BadgeClasse } from "../../../../../../components/notation/BadgeClasse";
import "../../../../../../components/notation/notation.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  LISTE_CLASSES,
  cheminNotationMission,
  formaterScore,
  hrefNotation,
  lireNumeroVersion,
  versionAffichee,
  type ResumeNotation,
} from "../../../../../../lib/notation";
import {
  AVERTISSEMENT_RECHERCHE_TRONQUEE,
  AVERTISSEMENT_RECHERCHE_TRONQUEE_EN,
  cheminConfiance,
  cheminCommentaireExplication,
  cheminConstats,
  cheminExplication,
  cheminPropositionPlan,
  detailGraviteConstat,
  detailNiveauConfiance,
  formaterPointsSignes,
  formaterRatio,
  hrefAnalyseNotation,
  libelleEtapeCombinaison,
  libelleSourceImpact,
  lireCapacite,
  lireCible,
  peutGenererCommentaire,
  phraseCombinaisons,
  phraseSimulation,
  type CombinaisonsNotation,
  type CommentaireExplication,
  type ConfianceNotation,
  type ConstatsNotation,
  type ExplicationNotation,
  type PlanActionPropose,
} from "../../../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../../../lib/notation-serveur";
import { CommentaireIa } from "./CommentaireIa";
import { EnregistrerPlan } from "./EnregistrerPlan";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Analyse de la notation", "Rating analysis") };
}

/**
 * Notation augmentée d'une version (PRD complémentaire §11.1) : indice de confiance (NOT-11),
 * constats de perception (NOT-10), contributions et simulateur de passage de classe (NOT-12),
 * plan d'action priorisé depuis la bibliothèque d'initiatives (NOT-17). Tous les chiffres
 * viennent de l'API (moteurs) ; la page n'en calcule aucun et ne conserve rien localement.
 */
export default async function PageAnalyseNotation({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  const { utilisateur } = await exigerLectureNotation();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const q = await searchParams;
  const cible = lireCible(q.cible);
  const capacite = lireCapacite(q.capacite);
  const resume = await chargerServeur<ResumeNotation>(cheminNotationMission(m.id));
  if (!resume.ok) {
    return resume.statut === 404 ? (
      <EtatVide
        titre={t("Aucune notation pour cette mission.", "No rating for this engagement.")}
        icone="barres"
      >
        <p>
          {t(
            "Lancez d'abord un calcul depuis l'onglet Notation.",
            "First run a computation from the Rating tab.",
          )}
        </p>
      </EtatVide>
    ) : (
      <EtatErreur
        titre={t("La notation n'a pas pu être chargée.", "The rating could not be loaded.")}
        message={resume.message}
        hrefReessayer={hrefNotation(m.id)}
      />
    );
  }
  const notation = resume.donnees;
  const choix = versionAffichee(notation.versions, lireNumeroVersion(q.version));
  if (choix.numero === null) {
    return (
      <EtatVide titre={t("Aucune version calculée.", "No version computed.")} icone="barres">
        <p>
          <Link href={hrefNotation(m.id)}>{t("Revenir à la notation", "Back to the rating")}</Link>{" "}
          {t("pour lancer un calcul.", "to run a computation.")}
        </p>
      </EtatVide>
    );
  }
  const numero = choix.numero;
  const [confiance, constats, explication, commentaire, plan] = await Promise.all([
    chargerServeur<ConfianceNotation>(cheminConfiance(notation.id, numero)),
    chargerServeur<ConstatsNotation>(cheminConstats(notation.id, numero)),
    chargerServeur<ExplicationNotation>(cheminExplication(notation.id, numero, cible)),
    chargerServeur<CommentaireExplication>(cheminCommentaireExplication(notation.id, numero)),
    chargerServeur<PlanActionPropose>(cheminPropositionPlan(notation.id, numero, capacite)),
  ]);
  const reessayer = hrefAnalyseNotation(m.id, numero);
  const gerer = aPermission(utilisateur.roles, "notation.gerer") && m.statut !== "cloturee";

  return (
    <div className="mp-notation">
      <p className="mp-texte-doux">
        {t(
          `Analyse de la version ${numero} : fiabilité de la note, écarts de perception, explication de la note et plan d'action.`,
          `Analysis of version ${numero}: score reliability, perception gaps, score explanation and action plan.`,
        )}{" "}
        <Link href={hrefNotation(m.id, numero)}>
          {t("Retour à la notation", "Back to the rating")}
        </Link>
      </p>

      <Carte titre={t("Indice de confiance", "Confidence index")}>
        {confiance.ok ? (
          <div className="mp-notation__section">
            <p>
              <strong>{formaterRatio(confiance.donnees.indice)}</strong>{" "}
              {t("(seuil du cabinet :", "(firm threshold:")}{" "}
              {formaterRatio(confiance.donnees.seuil)}){" "}
              <BadgeStatut
                tonalite={detailNiveauConfiance(confiance.donnees.niveau, langue).tonalite}
              >
                {detailNiveauConfiance(confiance.donnees.niveau, langue).libelle}
              </BadgeStatut>
            </p>
            <ul>
              <li>
                {t(
                  `Couverture des items : ${formaterRatio(confiance.donnees.couverture.valeur)} (poids ${confiance.donnees.couverture.poids} %)`,
                  `Item coverage: ${formaterRatio(confiance.donnees.couverture.valeur)} (weight ${confiance.donnees.couverture.poids}%)`,
                )}
              </li>
              <li>
                {t(
                  `Répondants : ${confiance.donnees.repondants.nombre} pour une cible de ${confiance.donnees.repondants.cible} (poids ${confiance.donnees.repondants.poids} %)`,
                  `Respondents: ${confiance.donnees.repondants.nombre} for a target of ${confiance.donnees.repondants.cible} (weight ${confiance.donnees.repondants.poids}%)`,
                )}
              </li>
              <li>
                {t(
                  `Solidité des preuves : ${formaterRatio(confiance.donnees.preuves.valeur)}, ${confiance.donnees.preuves.dimensions_etayees} dimension(s) étayée(s) sur ${confiance.donnees.preuves.dimensions} (poids ${confiance.donnees.preuves.poids} %)`,
                  `Evidence strength: ${formaterRatio(confiance.donnees.preuves.valeur)}, ${confiance.donnees.preuves.dimensions_etayees} dimension(s) supported out of ${confiance.donnees.preuves.dimensions} (weight ${confiance.donnees.preuves.poids}%)`,
                )}
              </li>
            </ul>
          </div>
        ) : (
          <EtatErreur
            titre={t("Indice indisponible.", "Index unavailable.")}
            message={confiance.message}
            hrefReessayer={reessayer}
          />
        )}
      </Carte>

      <Carte titre={t("Constats de perception", "Perception findings")}>
        {!constats.ok ? (
          <EtatErreur
            titre={t("Constats indisponibles.", "Findings unavailable.")}
            message={constats.message}
            hrefReessayer={reessayer}
          />
        ) : constats.donnees.constats.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun écart de perception significatif entre répondants (ou questionnaire collectif).",
              "No significant perception gap between respondents (or collective questionnaire).",
            )}
          </p>
        ) : (
          <ul className="mp-notation__section">
            {constats.donnees.constats.map((c) => (
              <li key={c.question}>
                <BadgeStatut tonalite={detailGraviteConstat(c.gravite, langue).tonalite}>
                  {detailGraviteConstat(c.gravite, langue).libelle}
                </BadgeStatut>{" "}
                {c.enonce}
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre={t("Explication de la note", "Score explanation")}>
        {!explication.ok ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>{explication.message}</p>
          </Alerte>
        ) : (
          <ExplicationNote
            e={explication.donnees}
            langue={langue}
            hrefCible={(c) =>
              `${hrefAnalyseNotation(m.id, numero)}&cible=${c}&capacite=${capacite}`
            }
          />
        )}
      </Carte>

      <Carte titre={t("Commentaire de l'IA (brouillon)", "AI comment (draft)")}>
        {!commentaire.ok ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>{commentaire.message}</p>
          </Alerte>
        ) : (
          <CommentaireIa
            key={`${numero}/${commentaire.donnees.commentaire?.id ?? "aucun"}`}
            notationId={notation.id}
            numero={numero}
            cible={cible}
            initial={commentaire.donnees.commentaire}
            peutGenerer={peutGenererCommentaire(utilisateur.roles, m.statut === "cloturee")}
            utilisateur={{ id: utilisateur.id, roles: utilisateur.roles }}
          />
        )}
      </Carte>

      <Carte titre={t("Plan d'action priorisé", "Prioritized action plan")}>
        {!plan.ok ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>{plan.message}</p>
          </Alerte>
        ) : plan.donnees.initiatives.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "La bibliothèque d'initiatives du cabinet est vide : ajoutez des initiatives types et leurs impacts observés.",
              "The firm's initiative library is empty: add standard initiatives and their observed impacts.",
            )}
          </p>
        ) : (
          <div className="mp-notation__section">
            <p className="mp-texte-doux">
              {t(
                `Priorité = besoin de la note × impact observé dans des contextes semblables ÷ effort ; capacité du client : ${plan.donnees.capacite} (utilisée : ${plan.donnees.capacite_utilisee}).`,
                `Priority = score need × impact observed in similar contexts ÷ effort; client capacity: ${plan.donnees.capacite} (used: ${plan.donnees.capacite_utilisee}).`,
              )}
            </p>
            <Tableau
              legende={t("Initiatives priorisées", "Prioritized initiatives")}
              cleLigne={(i) => i.code}
              lignes={plan.donnees.initiatives}
              colonnes={[
                { cle: "rang", entete: t("Rang", "Rank"), alignement: "droite" },
                { cle: "titre", entete: t("Initiative", "Initiative") },
                { cle: "priorite", entete: t("Priorité", "Priority"), alignement: "droite" },
                {
                  cle: "impact",
                  entete: t("Impact observé", "Observed impact"),
                  rendu: (i) =>
                    `${formaterScore(i.impact, langue)} ${t("pt", "pt")} (${libelleSourceImpact(i.source_impact, langue)})`,
                },
                { cle: "effort", entete: t("Effort", "Effort"), alignement: "droite" },
                {
                  cle: "retenue",
                  entete: t("Retenue", "Selected"),
                  rendu: (i) => (i.retenue ? t("Oui", "Yes") : i.motif),
                },
              ]}
            />
            {gerer ? (
              <EnregistrerPlan
                notationId={notation.id}
                numero={numero}
                capaciteInitiale={capacite}
              />
            ) : null}
          </div>
        )}
      </Carte>
    </div>
  );
}

function ExplicationNote({
  e,
  hrefCible,
  langue,
}: {
  e: ExplicationNotation;
  hrefCible: (c: string) => string;
  langue: Langue;
}) {
  const t = creerTraduire(langue);
  return (
    <div className="mp-notation__section">
      <p>
        {t("Score", "Score")} {formaterScore(e.score, langue)} <BadgeClasse classe={e.classe} /> :{" "}
        {t("somme des contributions", "sum of contributions")}{" "}
        {formaterScore(e.somme_contributions, langue)}.
      </p>
      <Tableau
        legende={t(
          "Contribution de chaque dimension à la note",
          "Contribution of each dimension to the score",
        )}
        cleLigne={(d) => d.dimension}
        lignes={e.dimensions}
        colonnes={[
          { cle: "libelle", entete: t("Dimension", "Dimension") },
          {
            cle: "score",
            entete: t("Score", "Score"),
            alignement: "droite",
            rendu: (d) => formaterScore(d.score, langue),
          },
          {
            cle: "contribution",
            entete: t("Contribution", "Contribution"),
            alignement: "droite",
            rendu: (d) => formaterPointsSignes(d.contribution, langue),
          },
          {
            cle: "ajustement",
            entete: t("dont ajustement", "of which adjustment"),
            alignement: "droite",
            rendu: (d) => formaterPointsSignes(d.ajustement, langue),
          },
          {
            cle: "pratiques",
            entete: t("Pratiques (contribution)", "Practices (contribution)"),
            rendu: (d) =>
              d.pratiques
                .filter((p) => p.statut === "repondu")
                .map((p) => `${p.indicateur} ${formaterPointsSignes(p.contribution, langue)}`)
                .join(" ; ") || "—",
          },
        ]}
      />
      {e.simulation ? (
        <>
          <p>
            <strong>{phraseSimulation(e.simulation, langue)}</strong>
          </p>
          {e.simulation.etapes.length > 0 ? (
            <Tableau
              legende={t("Pratiques à relever", "Practices to raise")}
              cleLigne={(x) => `${x.dimension}/${x.indicateur}`}
              lignes={e.simulation.etapes}
              colonnes={[
                { cle: "libelle", entete: t("Dimension", "Dimension") },
                { cle: "question", entete: t("Question", "Question") },
                {
                  cle: "points",
                  entete: t("Points", "Points"),
                  rendu: (x) =>
                    `${formaterScore(x.points_avant, langue)} → ${formaterScore(x.points_apres, langue)}`,
                },
                { cle: "paliers", entete: t("Paliers", "Steps"), alignement: "droite" },
                {
                  cle: "gain",
                  entete: t("Gain sur la note", "Gain on the score"),
                  alignement: "droite",
                  rendu: (x) => formaterPointsSignes(x.gain, langue),
                },
              ]}
            />
          ) : null}
        </>
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Classe A atteinte : aucune simulation proposée.",
            "Class A reached: no simulation offered.",
          )}
        </p>
      )}
      {e.combinaisons ? <CombinaisonsMinimales c={e.combinaisons} langue={langue} /> : null}
      <p className="mp-texte-doux mp-texte-petit">
        {t("Simuler une autre classe :", "Simulate another class:")}{" "}
        {LISTE_CLASSES.filter((c) => c !== "E").map((c, i) => (
          <span key={c}>
            {i > 0 ? " · " : ""}
            <Link href={hrefCible(c)}>{c}</Link>
          </span>
        ))}
        .{" "}
        {t(
          "Projection indicative calculée par le moteur ; elle ne crée aucune note.",
          "Indicative projection computed by the engine; it creates no score.",
        )}
      </p>
    </div>
  );
}

/**
 * Combinaisons MINIMALES d'améliorations (moteur exact, NOT-12) : le plus petit nombre de
 * pratiques à relever, puis le moins de paliers. Une recherche tronquée est signalée, jamais
 * présentée comme une impossibilité.
 */
function CombinaisonsMinimales({ c, langue }: { c: CombinaisonsNotation; langue: Langue }) {
  const t = creerTraduire(langue);
  return (
    <section
      className="mp-notation__section"
      aria-label={t(
        "Combinaisons minimales d'améliorations",
        "Minimal combinations of improvements",
      )}
    >
      <h3>
        {t(`Chemin le plus court vers la classe ${c.cible}`, `Shortest path to class ${c.cible}`)}
      </h3>
      <p>
        <strong>{phraseCombinaisons(c, langue)}</strong>
      </p>
      {c.tronquee ? (
        <Alerte
          tonalite="attention"
          titre={t("Recherche interrompue", "Search interrupted")}
          annonce="aucune"
        >
          <p>
            {langue === "en"
              ? AVERTISSEMENT_RECHERCHE_TRONQUEE_EN
              : AVERTISSEMENT_RECHERCHE_TRONQUEE}
          </p>
        </Alerte>
      ) : null}
      {c.combinaisons.length > 0 ? (
        <>
          <Tableau
            legende={t(
              `Combinaisons minimales vers la classe ${c.cible} (la première est la plus économe en paliers)`,
              `Minimal combinations toward class ${c.cible} (the first uses the fewest steps)`,
            )}
            cleLigne={(x) => String(x.rang)}
            lignes={c.combinaisons.map((k, i) => ({ ...k, rang: i + 1 }))}
            colonnes={[
              {
                cle: "rang",
                entete: t("Option", "Option"),
                alignement: "droite",
                rendu: (k) =>
                  k.rang === 1 ? t("1 (recommandée)", "1 (recommended)") : String(k.rang),
              },
              {
                cle: "etapes",
                entete: t("Pratiques à relever", "Practices to raise"),
                rendu: (k) => (
                  <ul>
                    {k.etapes.map((x) => (
                      <li key={`${x.dimension}/${x.indicateur}`}>
                        {x.libelle} — {libelleEtapeCombinaison(x, langue)}
                      </li>
                    ))}
                  </ul>
                ),
              },
              { cle: "nombre_paliers", entete: t("Paliers", "Steps"), alignement: "droite" },
              {
                cle: "score_projete",
                entete: t("Score projeté", "Projected score"),
                alignement: "droite",
                rendu: (k) =>
                  `${formaterScore(k.score_projete, langue)} (${t("classe", "class")} ${k.classe_projetee})`,
              },
            ]}
          />
          <p className="mp-texte-doux mp-texte-petit">
            {c.exhaustive
              ? t(
                  "Liste complète des combinaisons de cette taille (dans la limite demandée).",
                  "Complete list of combinations of this size (within the requested limit).",
                )
              : t("Liste partielle.", "Partial list.")}{" "}
            {t(
              "Projection indicative calculée par le moteur ; elle ne crée aucune note.",
              "Indicative projection computed by the engine; it creates no score.",
            )}
          </p>
        </>
      ) : null}
    </section>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeClasse } from "../../../../../../components/notation/BadgeClasse";
import "../../../../../../components/notation/notation.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
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
  GRAVITES_CONSTAT,
  NIVEAUX_CONFIANCE,
  SOURCES_IMPACT,
  cheminConfiance,
  cheminConstats,
  cheminExplication,
  cheminPropositionPlan,
  formaterPointsSignes,
  formaterRatio,
  hrefAnalyseNotation,
  lireCapacite,
  lireCible,
  phraseSimulation,
  type ConfianceNotation,
  type ConstatsNotation,
  type ExplicationNotation,
  type PlanActionPropose,
} from "../../../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../../../lib/notation-serveur";
import { EnregistrerPlan } from "./EnregistrerPlan";

export const metadata: Metadata = { title: "Analyse de la notation" };

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
      <EtatVide titre="Aucune notation pour cette mission." icone="barres">
        <p>Lancez d&apos;abord un calcul depuis l&apos;onglet Notation.</p>
      </EtatVide>
    ) : (
      <EtatErreur
        titre="La notation n'a pas pu être chargée."
        message={resume.message}
        hrefReessayer={hrefNotation(m.id)}
      />
    );
  }
  const notation = resume.donnees;
  const choix = versionAffichee(notation.versions, lireNumeroVersion(q.version));
  if (choix.numero === null) {
    return (
      <EtatVide titre="Aucune version calculée." icone="barres">
        <p>
          <Link href={hrefNotation(m.id)}>Revenir à la notation</Link> pour lancer un calcul.
        </p>
      </EtatVide>
    );
  }
  const numero = choix.numero;
  const [confiance, constats, explication, plan] = await Promise.all([
    chargerServeur<ConfianceNotation>(cheminConfiance(notation.id, numero)),
    chargerServeur<ConstatsNotation>(cheminConstats(notation.id, numero)),
    chargerServeur<ExplicationNotation>(cheminExplication(notation.id, numero, cible)),
    chargerServeur<PlanActionPropose>(cheminPropositionPlan(notation.id, numero, capacite)),
  ]);
  const reessayer = hrefAnalyseNotation(m.id, numero);
  const gerer = aPermission(utilisateur.roles, "notation.gerer") && m.statut !== "cloturee";

  return (
    <div className="mp-notation">
      <p className="mp-texte-doux">
        Analyse de la version {numero} : fiabilité de la note, écarts de perception, explication de
        la note et plan d&apos;action.{" "}
        <Link href={hrefNotation(m.id, numero)}>Retour à la notation</Link>
      </p>

      <Carte titre="Indice de confiance">
        {confiance.ok ? (
          <div className="mp-notation__section">
            <p>
              <strong>{formaterRatio(confiance.donnees.indice)}</strong> (seuil du cabinet :{" "}
              {formaterRatio(confiance.donnees.seuil)}){" "}
              <BadgeStatut tonalite={NIVEAUX_CONFIANCE[confiance.donnees.niveau].tonalite}>
                {NIVEAUX_CONFIANCE[confiance.donnees.niveau].libelle}
              </BadgeStatut>
            </p>
            <ul>
              <li>
                Couverture des items : {formaterRatio(confiance.donnees.couverture.valeur)} (poids{" "}
                {confiance.donnees.couverture.poids} %)
              </li>
              <li>
                Répondants : {confiance.donnees.repondants.nombre} pour une cible de{" "}
                {confiance.donnees.repondants.cible} (poids {confiance.donnees.repondants.poids} %)
              </li>
              <li>
                Solidité des preuves : {formaterRatio(confiance.donnees.preuves.valeur)},{" "}
                {confiance.donnees.preuves.dimensions_etayees} dimension(s) étayée(s) sur{" "}
                {confiance.donnees.preuves.dimensions} (poids {confiance.donnees.preuves.poids} %)
              </li>
            </ul>
          </div>
        ) : (
          <EtatErreur
            titre="Indice indisponible."
            message={confiance.message}
            hrefReessayer={reessayer}
          />
        )}
      </Carte>

      <Carte titre="Constats de perception">
        {!constats.ok ? (
          <EtatErreur
            titre="Constats indisponibles."
            message={constats.message}
            hrefReessayer={reessayer}
          />
        ) : constats.donnees.constats.length === 0 ? (
          <p className="mp-texte-doux">
            Aucun écart de perception significatif entre répondants (ou questionnaire collectif).
          </p>
        ) : (
          <ul className="mp-notation__section">
            {constats.donnees.constats.map((c) => (
              <li key={c.question}>
                <BadgeStatut tonalite={GRAVITES_CONSTAT[c.gravite].tonalite}>
                  {GRAVITES_CONSTAT[c.gravite].libelle}
                </BadgeStatut>{" "}
                {c.enonce}
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre="Explication de la note">
        {!explication.ok ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>{explication.message}</p>
          </Alerte>
        ) : (
          <ExplicationNote
            e={explication.donnees}
            hrefCible={(c) =>
              `${hrefAnalyseNotation(m.id, numero)}&cible=${c}&capacite=${capacite}`
            }
          />
        )}
      </Carte>

      <Carte titre="Plan d'action priorisé">
        {!plan.ok ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>{plan.message}</p>
          </Alerte>
        ) : plan.donnees.initiatives.length === 0 ? (
          <p className="mp-texte-doux">
            La bibliothèque d&apos;initiatives du cabinet est vide : ajoutez des initiatives types
            et leurs impacts observés.
          </p>
        ) : (
          <div className="mp-notation__section">
            <p className="mp-texte-doux">
              Priorité = besoin de la note × impact observé dans des contextes semblables ÷ effort ;
              capacité du client : {plan.donnees.capacite} (utilisée :{" "}
              {plan.donnees.capacite_utilisee}).
            </p>
            <Tableau
              legende="Initiatives priorisées"
              cleLigne={(i) => i.code}
              lignes={plan.donnees.initiatives}
              colonnes={[
                { cle: "rang", entete: "Rang", alignement: "droite" },
                { cle: "titre", entete: "Initiative" },
                { cle: "priorite", entete: "Priorité", alignement: "droite" },
                {
                  cle: "impact",
                  entete: "Impact observé",
                  rendu: (i) =>
                    `${formaterScore(i.impact)} pt (${SOURCES_IMPACT[i.source_impact]})`,
                },
                { cle: "effort", entete: "Effort", alignement: "droite" },
                { cle: "retenue", entete: "Retenue", rendu: (i) => (i.retenue ? "Oui" : i.motif) },
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
}: {
  e: ExplicationNotation;
  hrefCible: (c: string) => string;
}) {
  return (
    <div className="mp-notation__section">
      <p>
        Score {formaterScore(e.score)} <BadgeClasse classe={e.classe} /> : somme des contributions{" "}
        {formaterScore(e.somme_contributions)}.
      </p>
      <Tableau
        legende="Contribution de chaque dimension à la note"
        cleLigne={(d) => d.dimension}
        lignes={e.dimensions}
        colonnes={[
          { cle: "libelle", entete: "Dimension" },
          {
            cle: "score",
            entete: "Score",
            alignement: "droite",
            rendu: (d) => formaterScore(d.score),
          },
          {
            cle: "contribution",
            entete: "Contribution",
            alignement: "droite",
            rendu: (d) => formaterPointsSignes(d.contribution),
          },
          {
            cle: "ajustement",
            entete: "dont ajustement",
            alignement: "droite",
            rendu: (d) => formaterPointsSignes(d.ajustement),
          },
          {
            cle: "pratiques",
            entete: "Pratiques (contribution)",
            rendu: (d) =>
              d.pratiques
                .filter((p) => p.statut === "repondu")
                .map((p) => `${p.indicateur} ${formaterPointsSignes(p.contribution)}`)
                .join(" ; ") || "—",
          },
        ]}
      />
      {e.simulation ? (
        <>
          <p>
            <strong>{phraseSimulation(e.simulation)}</strong>
          </p>
          {e.simulation.etapes.length > 0 ? (
            <Tableau
              legende="Pratiques à relever"
              cleLigne={(x) => `${x.dimension}/${x.indicateur}`}
              lignes={e.simulation.etapes}
              colonnes={[
                { cle: "libelle", entete: "Dimension" },
                { cle: "question", entete: "Question" },
                {
                  cle: "points",
                  entete: "Points",
                  rendu: (x) =>
                    `${formaterScore(x.points_avant)} → ${formaterScore(x.points_apres)}`,
                },
                { cle: "paliers", entete: "Paliers", alignement: "droite" },
                {
                  cle: "gain",
                  entete: "Gain sur la note",
                  alignement: "droite",
                  rendu: (x) => formaterPointsSignes(x.gain),
                },
              ]}
            />
          ) : null}
        </>
      ) : (
        <p className="mp-texte-doux">Classe A atteinte : aucune simulation proposée.</p>
      )}
      <p className="mp-texte-doux mp-texte-petit">
        Simuler une autre classe :{" "}
        {LISTE_CLASSES.filter((c) => c !== "E").map((c, i) => (
          <span key={c}>
            {i > 0 ? " · " : ""}
            <Link href={hrefCible(c)}>{c}</Link>
          </span>
        ))}
        . Projection indicative calculée par le moteur ; elle ne crée aucune note.
      </p>
    </div>
  );
}

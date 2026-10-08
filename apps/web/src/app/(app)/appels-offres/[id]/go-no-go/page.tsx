import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/appels-offres/appels-offres.css";
import {
  FormulaireDecisionAo,
  FormulaireEvaluationAo,
} from "../../../../../components/appels-offres/ActionsAo";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  droitsAppelsOffres,
  formaterPointsDeBase,
  hrefFiche,
  hrefGoNoGo,
  LIBELLES_CRITERES,
  LIBELLES_ELIMINATOIRES,
  libelleRecommandation,
  libelleStatutAo,
  tonaliteRecommandation,
  tonaliteStatutAo,
  type FicheDetail,
  type GoNoGoAo,
} from "../../../../../lib/appels-offres";
import { exigerLectureAo } from "../../../../../lib/appels-offres-serveur";
import { formaterDateHeure } from "../../../../../lib/format";

export const metadata: Metadata = { title: "Go/no-go" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Score go/no-go (AO-02) : calculé par le moteur sur cinq critères (adéquation, références,
 * charge, marge estimée, concurrence connue), conservé à chaque évaluation ; la décision revient
 * à l'associé, motivée, sur la dernière évaluation. La marge (FIN-02) n'apparaît qu'avec le droit
 * financier : l'API la retire des réponses sinon.
 */
export default async function PageGoNoGo({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerLectureAo();
  const droits = droitsAppelsOffres(session.utilisateur.roles);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [fiche, gng] = await Promise.all([
    chargerServeur<FicheDetail>(`/api/appels-offres/${id}`),
    chargerServeur<GoNoGoAo>(`/api/appels-offres/${id}/go-no-go`),
  ]);
  if (!fiche.ok && fiche.statut === 404) notFound();
  if (!fiche.ok || !gng.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Go/no-go" retour={{ href: hrefFiche(id), libelle: "Fiche" }} />
        <EtatErreur
          titre="Le go/no-go n'a pas pu être chargé."
          message={!fiche.ok ? fiche.message : gng.ok ? "" : gng.message}
          hrefReessayer={hrefGoNoGo(id)}
        />
      </div>
    );
  }
  const f = fiche.donnees;
  const { evaluations, decisions } = gng.donnees;
  const derniere = evaluations[0];
  const evaluable = f.statut === "detecte" || f.statut === "go_no_go";
  const decidable = derniere && (f.statut === "go_no_go" || f.statut === "en_reponse");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`Go/no-go : ${f.titre}`}
        retour={{ href: hrefFiche(id), libelle: "Fiche" }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
            {libelleStatutAo(f.statut)}
          </BadgeStatut>
        }
      />

      {derniere ? (
        <Carte
          titre={`Évaluation n° ${derniere.numero} : ${derniere.score}/100`}
          actions={
            <BadgeStatut tonalite={tonaliteRecommandation(derniere.recommandation)}>
              {libelleRecommandation(derniere.recommandation)}
            </BadgeStatut>
          }
        >
          <dl className="mp-ao__definition">
            {derniere.resultat.criteres.map((c) => (
              <div key={c.critere} className="mp-ao__ligne-critere">
                <dt>
                  {LIBELLES_CRITERES[c.critere] ?? c.critere} (poids {c.poids})
                </dt>
                <dd>{c.note === null ? "non évalué" : `${c.note}/100`}</dd>
              </div>
            ))}
          </dl>
          {droits.finance && derniere.entrees.marge_estimee_bp !== undefined ? (
            <p className="mp-texte-doux mp-texte-petit">
              Marge estimée {formaterPointsDeBase(derniere.entrees.marge_estimee_bp)} pour une cible
              de {formaterPointsDeBase(derniere.entrees.marge_cible_bp)}.
            </p>
          ) : null}
          {derniere.resultat.eliminatoires.length > 0 ? (
            <p>
              Critères éliminatoires :{" "}
              {derniere.resultat.eliminatoires
                .map((e) => LIBELLES_ELIMINATOIRES[e] ?? e)
                .join(", ")}
              .
            </p>
          ) : null}
          <p className="mp-texte-doux mp-texte-petit">
            {derniere.auteur_nom} · {formaterDateHeure(derniere.cree_le)} · le moteur recommande,
            l&apos;associé décide.
          </p>
        </Carte>
      ) : (
        <EtatVide titre="Aucune évaluation." icone="drapeau">
          <p>Renseignez la charge et la concurrence connue : le score est calculé par le moteur.</p>
        </EtatVide>
      )}

      {droits.decider && decidable ? (
        <Carte titre="Décision de l'associé">
          <FormulaireDecisionAo
            id={f.id}
            evaluationId={derniere.id}
            goPossible={f.statut === "go_no_go"}
          />
        </Carte>
      ) : null}

      {droits.gerer && evaluable ? (
        <Carte titre={derniere ? "Nouvelle évaluation" : "Évaluer l'appel d'offres"}>
          <FormulaireEvaluationAo id={f.id} voitFinance={droits.finance} />
        </Carte>
      ) : null}

      <Carte titre="Décisions">
        {decisions.length === 0 ? (
          <p className="mp-texte-doux">Aucune décision.</p>
        ) : (
          <ul className="mp-liste-lignes">
            {decisions.map((d) => (
              <li key={d.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <span>{d.decision === "go" ? "Go" : "No-go"}</span>
                  <span className="mp-texte-doux mp-texte-petit">
                    {d.decideur_nom} · {formaterDateHeure(d.cree_le)} · {d.motif}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      {evaluations.length > 1 ? (
        <Carte titre="Évaluations précédentes">
          <ul className="mp-liste-lignes">
            {evaluations.slice(1).map((e) => (
              <li key={e.id} className="mp-liste-lignes__ligne">
                <span>
                  N° {e.numero} : {e.score}/100 · {libelleRecommandation(e.recommandation)} ·{" "}
                  {formaterDateHeure(e.cree_le)}
                </span>
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}
    </div>
  );
}

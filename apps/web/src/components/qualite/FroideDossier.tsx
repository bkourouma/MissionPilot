import type { ReactNode } from "react";
import type {
  ClasseRisque,
  DecisionAcceptation,
  NiveauRisqueClient,
  StatutSuivi,
  TypeLivrable,
} from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import {
  formaterNps,
  libelleClasse,
  libelleDecision,
  libelleNiveauRisque,
  libelleStatutSuivi,
  libelleType,
} from "../../lib/qualite";
import { lignesBudget, type DossierRevue } from "../../lib/qualite-froide";

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <details>
      <summary>{titre}</summary>
      <div className="mp-froide-dossier__corps">{children}</div>
    </details>
  );
}

function Definitions({ lignes }: { lignes: [string, ReactNode][] }) {
  return (
    <dl className="mp-froide__def">
      {lignes.map(([terme, valeur]) => (
        <div key={terme} style={{ display: "contents" }}>
          <dt>{terme}</dt>
          <dd>{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Dossier de la mission tirée, en lecture seule. Sections repliables natives (`details`), sans
 * piège clavier. Budget (FIN-02) : seules les valeurs présentes dans la réponse sont montrées,
 * rien n'évoque celles que l'API n'a pas renvoyées.
 */
export function FroideDossier({ dossier }: { dossier: DossierRevue }) {
  const m = dossier.mission;
  const budget = lignesBudget(dossier.budget);
  const sat = dossier.satisfaction;
  const der = dossier.derogations;
  return (
    <div className="mp-froide-dossier">
      <Section titre="Mission">
        <Definitions
          lignes={[
            ["Client", m.client_nom],
            ["Type de mission", m.type_mission_libelle ?? "—"],
            ["Directeur de mission", m.directeur_nom ?? "—"],
            ["Chef de mission", m.chef_nom ?? "—"],
            ["Période", `${formaterDate(m.date_debut)} au ${formaterDate(m.date_fin)}`],
            ["Signature", formaterDate(m.date_signature)],
            ["Clôture", formaterDate(m.cloturee_le)],
          ]}
        />
      </Section>
      <Section titre={`Livrables suivis et signatures (${dossier.suivis_qualite.length})`}>
        {dossier.suivis_qualite.length === 0 ? (
          <p>Aucun livrable suivi pour cette mission.</p>
        ) : (
          <ul>
            {dossier.suivis_qualite.map((s) => (
              <li key={s.id}>
                {s.libelle} ({libelleType(s.type_livrable as TypeLivrable)}, version {s.version}) :
                classe {libelleClasse(s.classe as ClasseRisque)},{" "}
                {libelleStatutSuivi(s.statut as StatutSuivi).toLowerCase()}
                {s.signature
                  ? `, signé par ${s.signature.signataire_nom ?? "—"} le ${formaterDateHeure(s.signature.signe_le)}`
                  : ", non signé"}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section titre="Acceptation de la mission">
        {dossier.acceptation ? (
          <Definitions
            lignes={[
              [
                "Niveau de risque",
                libelleNiveauRisque(dossier.acceptation.niveau_risque as NiveauRisqueClient),
              ],
              ["Décision", libelleDecision(dossier.acceptation.decision as DecisionAcceptation)],
              ["Évaluée le", formaterDateHeure(dossier.acceptation.evalue_le)],
              ["Conflits détectés", String(dossier.acceptation.conflits_detectes)],
            ]}
          />
        ) : (
          <p>Aucune évaluation d&apos;acceptation enregistrée.</p>
        )}
      </Section>
      <Section titre="Satisfaction du client">
        {sat.notes.length === 0 ? (
          <p>Aucune note de satisfaction saisie.</p>
        ) : (
          <>
            <p>
              {sat.synthese.total} réponse(s) : {sat.synthese.promoteurs} promoteur(s),{" "}
              {sat.synthese.passifs} passif(s), {sat.synthese.detracteurs} détracteur(s) · NPS{" "}
              {formaterNps(sat.synthese.nps)}
            </p>
            <ul>
              {sat.notes.map((n, i) => (
                <li key={`${n.saisi_le}-${i}`}>
                  {n.moment === "jalon" ? `Jalon ${n.jalon_libelle ?? ""}`.trim() : "Clôture"} :{" "}
                  {n.note} sur 10 ({formaterDate(n.saisi_le)})
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      <Section titre="Dérogations">
        {der.total === 0 ? (
          <p>Aucune dérogation demandée.</p>
        ) : (
          <p>
            {der.total} dérogation(s) : {der.approuvees} approuvée(s), {der.refusees} refusée(s),{" "}
            {der.demandees} en attente.
          </p>
        )}
      </Section>
      {dossier.methode ? (
        <Section titre="Méthode appliquée">
          <p>
            {dossier.methode.libelle} (version {dossier.methode.version})
          </p>
        </Section>
      ) : null}
      {budget.length > 0 ? (
        <Section
          titre={
            dossier.budget?.version_reference
              ? `Budget (version ${dossier.budget.version_reference})`
              : "Budget"
          }
        >
          <Definitions lignes={budget.map((l) => [l.libelle, l.valeur])} />
        </Section>
      ) : null}
    </div>
  );
}

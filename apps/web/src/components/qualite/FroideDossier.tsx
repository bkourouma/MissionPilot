import type { ReactNode } from "react";
import type {
  ClasseRisque,
  DecisionAcceptation,
  NiveauRisqueClient,
  StatutSuivi,
  TypeLivrable,
} from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function FroideDossier({ dossier }: { dossier: DossierRevue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const d = (v: string | null | undefined) => formaterDate(v, "UTC", langue);
  const dh = (v: string | null | undefined) => formaterDateHeure(v, undefined, langue);
  const m = dossier.mission;
  const budget = lignesBudget(dossier.budget, langue);
  const sat = dossier.satisfaction;
  const der = dossier.derogations;
  return (
    <div className="mp-froide-dossier">
      <Section titre={t("Mission", "Engagement")}>
        <Definitions
          lignes={[
            [t("Client", "Client"), m.client_nom],
            [t("Type de mission", "Engagement type"), m.type_mission_libelle ?? "—"],
            [t("Directeur de mission", "Engagement director"), m.directeur_nom ?? "—"],
            [t("Chef de mission", "Engagement manager"), m.chef_nom ?? "—"],
            [
              t("Période", "Period"),
              t(`${d(m.date_debut)} au ${d(m.date_fin)}`, `${d(m.date_debut)} to ${d(m.date_fin)}`),
            ],
            [t("Signature", "Signature"), d(m.date_signature)],
            [t("Clôture", "Close-out"), d(m.cloturee_le)],
          ]}
        />
      </Section>
      <Section
        titre={t(
          `Livrables suivis et signatures (${dossier.suivis_qualite.length})`,
          `Tracked deliverables and signatures (${dossier.suivis_qualite.length})`,
        )}
      >
        {dossier.suivis_qualite.length === 0 ? (
          <p>
            {t(
              "Aucun livrable suivi pour cette mission.",
              "No tracked deliverable for this engagement.",
            )}
          </p>
        ) : (
          <ul>
            {dossier.suivis_qualite.map((s) => (
              <li key={s.id}>
                {s.libelle} ({libelleType(s.type_livrable as TypeLivrable, langue)},{" "}
                {t("version", "version")} {s.version}) : {t("classe", "class")}{" "}
                {libelleClasse(s.classe as ClasseRisque, langue)},{" "}
                {libelleStatutSuivi(s.statut as StatutSuivi, langue).toLowerCase()}
                {s.signature
                  ? t(
                      `, signé par ${s.signature.signataire_nom ?? "—"} le ${dh(s.signature.signe_le)}`,
                      `, signed by ${s.signature.signataire_nom ?? "—"} on ${dh(s.signature.signe_le)}`,
                    )
                  : t(", non signé", ", not signed")}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section titre={t("Acceptation de la mission", "Engagement acceptance")}>
        {dossier.acceptation ? (
          <Definitions
            lignes={[
              [
                t("Niveau de risque", "Risk level"),
                libelleNiveauRisque(
                  dossier.acceptation.niveau_risque as NiveauRisqueClient,
                  langue,
                ),
              ],
              [
                t("Décision", "Decision"),
                libelleDecision(dossier.acceptation.decision as DecisionAcceptation, langue),
              ],
              [t("Évaluée le", "Assessed on"), dh(dossier.acceptation.evalue_le)],
              [
                t("Conflits détectés", "Conflicts detected"),
                String(dossier.acceptation.conflits_detectes),
              ],
            ]}
          />
        ) : (
          <p>
            {t(
              "Aucune évaluation d'acceptation enregistrée.",
              "No acceptance assessment recorded.",
            )}
          </p>
        )}
      </Section>
      <Section titre={t("Satisfaction du client", "Client satisfaction")}>
        {sat.notes.length === 0 ? (
          <p>{t("Aucune note de satisfaction saisie.", "No satisfaction score entered.")}</p>
        ) : (
          <>
            <p>
              {t(
                `${sat.synthese.total} réponse(s) : ${sat.synthese.promoteurs} promoteur(s), ${sat.synthese.passifs} passif(s), ${sat.synthese.detracteurs} détracteur(s)`,
                `${sat.synthese.total} response(s): ${sat.synthese.promoteurs} promoter(s), ${sat.synthese.passifs} passive(s), ${sat.synthese.detracteurs} detractor(s)`,
              )}{" "}
              · NPS {formaterNps(sat.synthese.nps, langue)}
            </p>
            <ul>
              {sat.notes.map((n, i) => (
                <li key={`${n.saisi_le}-${i}`}>
                  {n.moment === "jalon"
                    ? `${t("Jalon", "Milestone")} ${n.jalon_libelle ?? ""}`.trim()
                    : t("Clôture", "Close-out")}{" "}
                  : {n.note} {t("sur 10", "out of 10")} ({d(n.saisi_le)})
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      <Section titre={t("Dérogations", "Waivers")}>
        {der.total === 0 ? (
          <p>{t("Aucune dérogation demandée.", "No waiver requested.")}</p>
        ) : (
          <p>
            {t(
              `${der.total} dérogation(s) : ${der.approuvees} approuvée(s), ${der.refusees} refusée(s), ${der.demandees} en attente.`,
              `${der.total} waiver(s): ${der.approuvees} approved, ${der.refusees} declined, ${der.demandees} pending.`,
            )}
          </p>
        )}
      </Section>
      {dossier.methode ? (
        <Section titre={t("Méthode appliquée", "Method applied")}>
          <p>
            {dossier.methode.libelle} ({t("version", "version")} {dossier.methode.version})
          </p>
        </Section>
      ) : null}
      {budget.length > 0 ? (
        <Section
          titre={
            dossier.budget?.version_reference
              ? t(
                  `Budget (version ${dossier.budget.version_reference})`,
                  `Budget (version ${dossier.budget.version_reference})`,
                )
              : "Budget"
          }
        >
          <Definitions lignes={budget.map((l) => [l.libelle, l.valeur])} />
        </Section>
      ) : null}
    </div>
  );
}

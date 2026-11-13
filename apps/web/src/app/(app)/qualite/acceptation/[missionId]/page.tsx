import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/qualite/qualite.css";
import { FormulaireAcceptation } from "../../../../../components/qualite/FormulaireAcceptation";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import type { MissionDetaillee } from "../../../../../lib/missions";
import {
  cheminAcceptation,
  droitsQualite,
  hrefAcceptation,
  libelleDecision,
  libelleFacteurRisque,
  libelleNatureConflit,
  libelleNiveauRisque,
  tonaliteNiveauRisque,
  type VueAcceptation,
} from "../../../../../lib/qualite";
import { exigerRelectureQualite } from "../../../../../lib/qualite-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Acceptation de mission", "Engagement acceptance") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acceptation d'une mission (QUA-07) : conflits d'intérêts détectés par le serveur à partir des
 * relations déclarées entre clients, profil de risque, décision motivée et historique des
 * évaluations (ajout seul).
 */
export default async function PageAcceptation({
  params,
}: {
  params: Promise<{ missionId: string }>;
}) {
  const session = await exigerRelectureQualite();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { missionId } = await params;
  if (!UUID.test(missionId)) notFound();
  const [mission, r] = await Promise.all([
    chargerServeur<MissionDetaillee>(`/api/missions/${encodeURIComponent(missionId)}`),
    chargerServeur<VueAcceptation>(cheminAcceptation(missionId)),
  ]);
  if ((!mission.ok && mission.statut === 404) || (!r.ok && r.statut === 404)) notFound();
  const droits = droitsQualite(session.utilisateur.roles);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t(
          `Acceptation : ${mission.ok ? mission.donnees.intitule : "mission"}`,
          `Acceptance: ${mission.ok ? mission.donnees.intitule : "engagement"}`,
        )}
        soustitre={
          mission.ok
            ? t(
                `Client : ${mission.donnees.client_raison_sociale}`,
                `Client: ${mission.donnees.client_raison_sociale}`,
              )
            : undefined
        }
        retour={{
          href: "/qualite/acceptation",
          libelle: t("Acceptation de mission", "Engagement acceptance"),
        }}
        badges={
          r.ok && r.donnees.derniere ? (
            <>
              <BadgeStatut tonalite={tonaliteNiveauRisque(r.donnees.derniere.niveau_risque)}>
                {t("Risque", "Risk")}{" "}
                {libelleNiveauRisque(r.donnees.derniere.niveau_risque, langue).toLowerCase()}
              </BadgeStatut>
              <BadgeStatut
                tonalite={r.donnees.derniere.decision === "refusee" ? "danger" : "neutre"}
              >
                {libelleDecision(r.donnees.derniere.decision, langue)}
              </BadgeStatut>
            </>
          ) : undefined
        }
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("L'acceptation n'a pas pu être chargée.", "The acceptance could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefAcceptation(missionId)}
        />
      ) : (
        <>
          <Carte titre={t("Conflits d'intérêts détectés", "Conflicts of interest detected")}>
            {r.donnees.conflits_actuels.length === 0 ? (
              <EtatVide titre={t("Aucun conflit détecté.", "No conflict detected.")} icone="succes">
                <p>
                  {t(
                    "Aucune relation déclarée (même groupe, investisseur et cible, concurrent) ne lie ce client à un autre client du cabinet.",
                    "No declared relationship (same group, investor and target, competitor) links this client to another client of the firm.",
                  )}
                </p>
              </EtatVide>
            ) : (
              <ul className="mp-liste-lignes">
                {r.donnees.conflits_actuels.map((c) => (
                  <li key={c.relation_id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <span>{c.client_lie_nom}</span>
                      <span className="mp-texte-doux mp-texte-petit">
                        {libelleNatureConflit(c.nature, langue)} ·{" "}
                        {t(
                          `${c.missions_en_cours} mission(s) en cours`,
                          `${c.missions_en_cours} ongoing engagement(s)`,
                        )}
                        {c.note ? ` · ${c.note}` : ""}
                      </span>
                    </div>
                    <BadgeStatut tonalite="attention">{t("À examiner", "To review")}</BadgeStatut>
                  </li>
                ))}
              </ul>
            )}
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "Les relations se déclarent par un directeur de mission ou un associé.",
                "Relationships are declared by an engagement director or a partner.",
              )}
            </p>
          </Carte>

          <Carte titre={t("Évaluer et décider", "Assess and decide")}>
            <FormulaireAcceptation
              missionId={missionId}
              conflits={r.donnees.conflits_actuels.length}
              peutDecider={droits.signer}
            />
          </Carte>

          <Carte titre={t("Historique des évaluations", "Assessment history")}>
            {r.donnees.historique.length === 0 ? (
              <p className="mp-texte-doux">
                {t("Aucune évaluation enregistrée.", "No assessment recorded.")}
              </p>
            ) : (
              <ol className="mp-liste-lignes">
                {r.donnees.historique.map((a) => (
                  <li key={a.id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <span>
                        {libelleDecision(a.decision, langue)} · {t("risque", "risk")}{" "}
                        {libelleNiveauRisque(a.niveau_risque, langue).toLowerCase()}
                      </span>
                      <span className="mp-texte-doux mp-texte-petit">
                        {a.evalue_par_nom ?? "—"} ·{" "}
                        {formaterDateHeure(a.evalue_le, undefined, langue)} ·{" "}
                        {t(`${a.conflits.length} conflit(s)`, `${a.conflits.length} conflict(s)`)}
                        {a.profil_risque.facteurs.length > 0
                          ? ` · ${a.profil_risque.facteurs
                              .map((f) => libelleFacteurRisque(f, langue))
                              .join(", ")}`
                          : ""}
                      </span>
                      {a.motif ? <span className="mp-texte-petit">« {a.motif} »</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Carte>
        </>
      )}
    </div>
  );
}

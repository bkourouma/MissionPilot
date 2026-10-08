import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/qualite/qualite.css";
import { FormulaireAcceptation } from "../../../../../components/qualite/FormulaireAcceptation";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import type { MissionDetaillee } from "../../../../../lib/missions";
import {
  cheminAcceptation,
  droitsQualite,
  hrefAcceptation,
  libelleDecision,
  libelleNatureConflit,
  libelleNiveauRisque,
  tonaliteNiveauRisque,
  type VueAcceptation,
} from "../../../../../lib/qualite";
import { exigerRelectureQualite } from "../../../../../lib/qualite-serveur";
import { FACTEURS_RISQUE_CLIENT } from "@missionpilot/shared";

export const metadata: Metadata = { title: "Acceptation de mission" };

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
        titre={`Acceptation : ${mission.ok ? mission.donnees.intitule : "mission"}`}
        soustitre={mission.ok ? `Client : ${mission.donnees.client_raison_sociale}` : undefined}
        retour={{ href: "/qualite/acceptation", libelle: "Acceptation de mission" }}
        badges={
          r.ok && r.donnees.derniere ? (
            <>
              <BadgeStatut tonalite={tonaliteNiveauRisque(r.donnees.derniere.niveau_risque)}>
                Risque {libelleNiveauRisque(r.donnees.derniere.niveau_risque).toLowerCase()}
              </BadgeStatut>
              <BadgeStatut
                tonalite={r.donnees.derniere.decision === "refusee" ? "danger" : "neutre"}
              >
                {libelleDecision(r.donnees.derniere.decision)}
              </BadgeStatut>
            </>
          ) : undefined
        }
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'acceptation n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefAcceptation(missionId)}
        />
      ) : (
        <>
          <Carte titre="Conflits d'intérêts détectés">
            {r.donnees.conflits_actuels.length === 0 ? (
              <EtatVide titre="Aucun conflit détecté." icone="succes">
                <p>
                  Aucune relation déclarée (même groupe, investisseur et cible, concurrent) ne lie
                  ce client à un autre client du cabinet.
                </p>
              </EtatVide>
            ) : (
              <ul className="mp-liste-lignes">
                {r.donnees.conflits_actuels.map((c) => (
                  <li key={c.relation_id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <span>{c.client_lie_nom}</span>
                      <span className="mp-texte-doux mp-texte-petit">
                        {libelleNatureConflit(c.nature)} · {c.missions_en_cours} mission(s) en cours
                        {c.note ? ` · ${c.note}` : ""}
                      </span>
                    </div>
                    <BadgeStatut tonalite="attention">À examiner</BadgeStatut>
                  </li>
                ))}
              </ul>
            )}
            <p className="mp-texte-doux mp-texte-petit">
              Les relations se déclarent par un directeur de mission ou un associé.
            </p>
          </Carte>

          <Carte titre="Évaluer et décider">
            <FormulaireAcceptation
              missionId={missionId}
              conflits={r.donnees.conflits_actuels.length}
              peutDecider={droits.signer}
            />
          </Carte>

          <Carte titre="Historique des évaluations">
            {r.donnees.historique.length === 0 ? (
              <p className="mp-texte-doux">Aucune évaluation enregistrée.</p>
            ) : (
              <ol className="mp-liste-lignes">
                {r.donnees.historique.map((a) => (
                  <li key={a.id} className="mp-liste-lignes__ligne">
                    <div className="mp-liste-lignes__texte">
                      <span>
                        {libelleDecision(a.decision)} · risque{" "}
                        {libelleNiveauRisque(a.niveau_risque).toLowerCase()}
                      </span>
                      <span className="mp-texte-doux mp-texte-petit">
                        {a.evalue_par_nom ?? "—"} · {formaterDateHeure(a.evalue_le)} ·{" "}
                        {a.conflits.length} conflit(s)
                        {a.profil_risque.facteurs.length > 0
                          ? ` · ${a.profil_risque.facteurs
                              .map(
                                (f) =>
                                  FACTEURS_RISQUE_CLIENT.find((x) => x.code === f)?.libelle ?? f,
                              )
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

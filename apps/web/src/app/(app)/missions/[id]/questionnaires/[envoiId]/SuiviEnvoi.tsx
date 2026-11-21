"use client";

import { useState, type FormEvent } from "react";
import type { Role } from "@missionpilot/shared";
import { useT, useLangue } from "../../../../../../components/i18n/FournisseurLangue";
import { BarreProgression } from "../../../../../../components/questionnaires/BarreProgression";
import { BoutonConfirmation } from "../../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../../../components/formulaires/useFormulaire";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../../components/ui/CaseACocher";
import { Champ } from "../../../../../../components/ui/Champ";
import { Icone } from "../../../../../../components/ui/Icone";
import { api } from "../../../../../../lib/api";
import { formaterDateHeure } from "../../../../../../lib/format";
import {
  actionsEnvoi,
  dateDuJour,
  libelleStatut,
  messageQuestionnaire,
  messageRelance,
  reglagesDepuisEnvoi,
  relanceRecente,
  repondantEnAttente,
  STATUT_REPONSE,
  texteRelances,
  validerReglages,
  type EnvoiDetail,
  type RepondantEnvoi,
  type SaisieReglages,
} from "../../../../../../lib/questionnaires";
import "../../../../../../components/questionnaires/questionnaires.css";

export interface SuiviEnvoiProps {
  envoi: EnvoiDetail;
  roles: readonly Role[];
  missionCloturee: boolean;
}

const cheminEnvoi = (id: string, action = "") =>
  `/api/questionnaires/envois/${encodeURIComponent(id)}${action}`;

/**
 * Suivi d'un envoi : actions (envoyer, relancer, clore), réglages (relances automatiques,
 * date limite) et suivi par répondant (statut, progression calculée par l'API, relances).
 * Aucune réponse n'est lue ici : seule la progression d'une saisie est visible.
 */
export function SuiviEnvoi({ envoi, roles, missionCloturee }: SuiviEnvoiProps) {
  const t = useT();
  const langue = useLangue();
  const a = actionsEnvoi(envoi, { roles, missionCloturee }, langue);
  const enAttente = envoi.repondants.filter((r) => repondantEnAttente(envoi, r));
  const relancesTotal = envoi.repondants.reduce((n, r) => n + r.relances, 0);
  const cle = `${envoi.statut}-${relancesTotal}`;

  return (
    <div className="mp-pile mp-pile--large">
      {a.raisonLectureSeule ? (
        <p className="mp-indice mp-texte-doux">
          <Icone nom="cadenas" taille={16} />
          <span>{a.raisonLectureSeule}</span>
        </p>
      ) : null}
      {a.envoyer || a.relancer || a.clore ? (
        <ActionsPrincipales envoi={envoi} enAttente={enAttente.length} cle={cle} actions={a} />
      ) : null}
      {a.modifierReglages ? <ReglagesEnvoi envoi={envoi} /> : null}
      {envoi.mode === "collectif" && envoi.reponse_collective ? (
        <ReponsePartagee envoi={envoi} />
      ) : null}
      <section className="mp-pile" aria-labelledby="titre-repondants">
        <h3 id="titre-repondants" className="mp-section__titre">
          {t(`Répondants (${envoi.repondants.length})`, `Respondents (${envoi.repondants.length})`)}
        </h3>
        <ul
          className="mp-liste-lignes"
          aria-label={t("Répondants du questionnaire", "Questionnaire respondents")}
        >
          {envoi.repondants.map((r) => (
            <LigneRepondant
              key={r.id}
              envoi={envoi}
              r={r}
              relancer={a.relancer && repondantEnAttente(envoi, r)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ActionsPrincipales({
  envoi,
  enAttente,
  cle,
  actions,
}: {
  envoi: EnvoiDetail;
  enAttente: number;
  cle: string;
  actions: ReturnType<typeof actionsEnvoi>;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<never>();
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [attente, marquer] = useAttenteRafraichissement(cle);
  const n = envoi.repondants.length;
  // Le bouton de confirmation revient à son état initial après l'action, réussie ou non
  // (`false`) : l'écran rafraîchi retire ensuite les actions devenues impossibles.
  const executer = async (
    action: "envoyer" | "relancer" | "clore",
    succes: (r: { relances?: number }) => string,
  ): Promise<false> => {
    await f.envoyer(
      { ok: true, charge: action === "relancer" ? {} : undefined },
      (c) => api.post<{ relances?: number }>(cheminEnvoi(envoi.id, `/${action}`), c),
      {
        messageSpecifique: (e) =>
          action === "relancer" ? messageRelance(e, langue) : messageQuestionnaire(e, langue),
        apres: (r) => {
          setAnnonce(succes(r));
          marquer();
        },
      },
    );
    return false;
  };

  return (
    <section className="mp-pile" aria-labelledby="titre-actions-envoi">
      <h3 id="titre-actions-envoi" className="mp-visuellement-cache">
        {t("Actions sur le questionnaire", "Questionnaire actions")}
      </h3>
      <div className="mp-barre-actions">
        {actions.envoyer ? (
          <BoutonConfirmation
            libelle={t(
              `Envoyer aux ${n} répondant${n > 1 ? "s" : ""}`,
              `Send to the ${n} respondent${n > 1 ? "s" : ""}`,
            )}
            icone="envoyer"
            variante="primaire"
            question={t(
              `Envoyer « ${envoi.titre} » ? Chaque répondant reçoit une notification et un e-mail${envoi.relances_auto ? " ; les relances automatiques (J+3, J+7) sont programmées" : ""}.`,
              `Send "${envoi.titre}"? Each respondent receives a notification and an email${envoi.relances_auto ? "; automatic reminders (D+3, D+7) are scheduled" : ""}.`,
            )}
            libelleConfirmation={t("Oui, envoyer", "Yes, send")}
            texteChargement={t("Envoi…", "Sending…")}
            action={() =>
              executer("envoyer", () =>
                t(
                  `Questionnaire envoyé à ${n} répondant${n > 1 ? "s" : ""}.`,
                  `Questionnaire sent to ${n} respondent${n > 1 ? "s" : ""}.`,
                ),
              )
            }
          />
        ) : null}
        {actions.relancer ? (
          enAttente > 0 ? (
            <BoutonConfirmation
              libelle={t(
                `Relancer les ${enAttente} répondant${enAttente > 1 ? "s" : ""} en attente`,
                `Remind the ${enAttente} pending respondent${enAttente > 1 ? "s" : ""}`,
              )}
              icone="courrier"
              question={t(
                `Relancer par e-mail ${enAttente > 1 ? `les ${enAttente} répondants` : "le répondant"} qui n'${enAttente > 1 ? "ont" : "a"} pas soumis ? Un répondant relancé il y a moins de 24 h ne l'est pas de nouveau.`,
                `Remind by email ${enAttente > 1 ? `the ${enAttente} respondents` : "the respondent"} who ${enAttente > 1 ? "have" : "has"} not submitted? A respondent reminded less than 24 hours ago is not reminded again.`,
              )}
              libelleConfirmation={t("Oui, relancer", "Yes, remind")}
              texteChargement={t("Relance…", "Reminding…")}
              action={() =>
                executer("relancer", (r) => {
                  const k = r.relances ?? 0;
                  return t(
                    `${k} relance${k > 1 ? "s" : ""} envoyée${k > 1 ? "s" : ""} par e-mail.`,
                    `${k} reminder${k > 1 ? "s" : ""} sent by email.`,
                  );
                })
              }
            />
          ) : (
            <p className="mp-texte-doux">
              {t(
                "Tous les répondants ont soumis : aucune relance à envoyer.",
                "All respondents have submitted: no reminder to send.",
              )}
            </p>
          )
        ) : null}
        {actions.clore ? (
          <BoutonConfirmation
            libelle={t("Clore le questionnaire", "Close the questionnaire")}
            icone="cadenas"
            question={t(
              "Clore le questionnaire ? Plus aucune saisie ni relance ne sera possible ; les réponses soumises restent lisibles.",
              "Close the questionnaire? No more entries or reminders will be possible; submitted responses remain readable.",
            )}
            libelleConfirmation={t("Oui, clore", "Yes, close")}
            texteChargement={t("Clôture…", "Closing…")}
            action={() =>
              executer("clore", () =>
                t(
                  "Questionnaire clos : la saisie est fermée.",
                  "Questionnaire closed: entry is closed.",
                ),
              )
            }
          />
        ) : null}
      </div>
      {attente ? (
        <p className="mp-texte-doux mp-texte-petit" role="status">
          {t("Mise à jour du suivi…", "Updating the tracking…")}
        </p>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={annonce}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action not possible")}
      />
    </section>
  );
}

function ReglagesEnvoi({ envoi }: { envoi: EnvoiDetail }) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieReglages>(() => reglagesDepuisEnvoi(envoi));
  const f = useFormulaire<"date_limite" | "relances_auto">();
  const aujourdhui = dateDuJour(new Date());
  const avant = reglagesDepuisEnvoi(envoi);
  const modifie = s.relances_auto !== avant.relances_auto || s.date_limite !== avant.date_limite;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerReglages(s, envoi, aujourdhui, langue),
      (c) => api.patch<EnvoiDetail>(cheminEnvoi(envoi.id), c),
      {
        succes: t("Réglages enregistrés.", "Settings saved."),
        messageSpecifique: (e) => messageQuestionnaire(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-formulaire--ligne mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-labelledby="titre-reglages-envoi"
    >
      <h3 id="titre-reglages-envoi" className="mp-sous-formulaire__titre">
        {t("Réglages", "Settings")}
      </h3>
      <div className="mp-grille-champs">
        <CaseACocher
          libelle={t("Relances automatiques par e-mail", "Automatic email reminders")}
          aide={
            envoi.statut === "brouillon"
              ? t(
                  "À J+3 puis J+7 après l'envoi, aux seuls répondants qui n'ont pas soumis.",
                  "At D+3 then D+7 after sending, only to respondents who have not submitted.",
                )
              : t(
                  "J+3 puis J+7 après l'envoi, aux seuls répondants qui n'ont pas soumis. Désactivées, les relances à venir ne partent pas.",
                  "D+3 then D+7 after sending, only to respondents who have not submitted. When off, upcoming reminders are not sent.",
                )
          }
          checked={s.relances_auto}
          onChange={(e) => setS((x) => ({ ...x, relances_auto: e.target.checked }))}
        />
        <Champ
          libelle={t("Date limite", "Due date")}
          name="date_limite"
          type="date"
          min={aujourdhui}
          value={s.date_limite}
          erreur={f.erreurs.date_limite ?? f.erreurs.relances_auto}
          aide={t(
            "Facultative. Passé ce jour (inclus), le portail refuse toute saisie et toute soumission : repoussez la date pour prolonger, ou videz-la pour lever la limite.",
            "Optional. After this day (inclusive), the portal rejects any entry and submission: push the date back to extend, or clear it to remove the limit.",
          )}
          onChange={(e) => setS((x) => ({ ...x, date_limite: e.target.value }))}
        />
      </div>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
          disabled={!modifie}
        >
          {t("Enregistrer les réglages", "Save settings")}
        </Bouton>
      </div>
    </form>
  );
}

function ReponsePartagee({ envoi }: { envoi: EnvoiDetail }) {
  const t = useT();
  const langue = useLangue();
  const c = envoi.reponse_collective;
  if (!c) return null;
  const s = libelleStatut(STATUT_REPONSE, c.statut, langue);
  return (
    <section className="mp-carte" aria-labelledby="titre-reponse-partagee">
      <div className="mp-carte__entete">
        <h3 id="titre-reponse-partagee" className="mp-carte__titre">
          {t("Réponse partagée", "Shared response")}
        </h3>
        <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>
      </div>
      <BarreProgression
        progression={c.progression}
        libelle={t("Progression de la réponse partagée", "Progress of the shared response")}
      />
      <p className="mp-texte-doux mp-texte-petit">
        {c.statut === "soumise" && c.soumise_le
          ? t(
              `Soumise le ${formaterDateHeure(c.soumise_le)}${c.soumise_par_nom ? ` par ${c.soumise_par_nom}` : ""} : elle est verrouillée.`,
              `Submitted on ${formaterDateHeure(c.soumise_le, undefined, langue)}${c.soumise_par_nom ? ` by ${c.soumise_par_nom}` : ""}: it is locked.`,
            )
          : c.derniere_saisie
            ? t(
                `Dernière saisie le ${formaterDateHeure(c.derniere_saisie)}. Le contenu d'une saisie en cours n'est pas visible du cabinet.`,
                `Last entry on ${formaterDateHeure(c.derniere_saisie, undefined, langue)}. The content of an entry in progress is not visible to the firm.`,
              )
            : t("Aucune saisie pour l'instant.", "No entry yet.")}
      </p>
    </section>
  );
}

function LigneRepondant({
  envoi,
  r,
  relancer,
}: {
  envoi: EnvoiDetail;
  r: RepondantEnvoi;
  relancer: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<never>();
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [attente, marquer] = useAttenteRafraichissement(`${r.relances}`);
  const recente = relanceRecente(r.derniere_relance, new Date());
  const statut = r.statut ? libelleStatut(STATUT_REPONSE, r.statut, langue) : null;

  return (
    <li className="mp-liste-lignes__ligne">
      <div className="mp-repondant mp-pleine-largeur">
        <div className="mp-repondant__identite">
          <strong>{r.nom}</strong>
          <span className="mp-texte-petit">
            {r.fonction ? `${r.fonction} · ${r.email}` : r.email}
          </span>
          {statut ? (
            <span>
              <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            </span>
          ) : null}
        </div>
        <div className="mp-repondant__suivi">
          {r.progression ? (
            <BarreProgression
              progression={r.progression}
              libelle={t(`Progression de ${r.nom}`, `Progress of ${r.nom}`)}
            />
          ) : null}
          <span className="mp-texte-doux mp-texte-petit">
            {r.statut === "soumise" && r.soumise_le
              ? t(
                  `Soumis le ${formaterDateHeure(r.soumise_le)}`,
                  `Submitted on ${formaterDateHeure(r.soumise_le, undefined, langue)}`,
                )
              : r.derniere_saisie
                ? t(
                    `Dernière saisie le ${formaterDateHeure(r.derniere_saisie)}`,
                    `Last entry on ${formaterDateHeure(r.derniere_saisie, undefined, langue)}`,
                  )
                : envoi.mode === "collectif"
                  ? t("Contribue à la réponse partagée", "Contributes to the shared response")
                  : t("Aucune saisie", "No entry")}
          </span>
          <span className="mp-texte-doux mp-texte-petit">
            {`${texteRelances(r.relances, langue)}${r.derniere_relance ? t(`, la dernière le ${formaterDateHeure(r.derniere_relance)}`, `, the last on ${formaterDateHeure(r.derniere_relance, undefined, langue)}`) : ""}`}
          </span>
          {recente && relancer ? (
            <span className="mp-indice mp-texte-petit">
              <Icone nom="horloge" taille={16} />
              <span>
                {t(
                  "Relancé il y a moins de 24 h : une nouvelle relance sera refusée d'ici là.",
                  "Reminded less than 24 hours ago: a new reminder will be refused until then.",
                )}
              </span>
            </span>
          ) : null}
        </div>
        {relancer ? (
          <div>
            <Bouton
              variante="secondaire"
              icone="courrier"
              chargement={f.enCours || attente}
              texteChargement={t("Relance…", "Reminding…")}
              aria-label={t(`Relancer ${r.nom} par e-mail`, `Remind ${r.nom} by email`)}
              onClick={() =>
                void f.envoyer(
                  { ok: true, charge: { repondant_ids: [r.id] } },
                  (c) => api.post<{ relances: number }>(cheminEnvoi(envoi.id, "/relancer"), c),
                  {
                    messageSpecifique: (e) => messageRelance(e, langue),
                    apres: (res) => {
                      setAnnonce(
                        res.relances > 0
                          ? t(
                              `${r.nom} a été relancé par e-mail.`,
                              `${r.nom} was reminded by email.`,
                            )
                          : t(
                              `Aucune relance envoyée : ${r.nom} ne peut plus répondre (compte ou accès au portail inactif).`,
                              `No reminder sent: ${r.nom} can no longer respond (inactive account or portal access).`,
                            ),
                      );
                      marquer();
                    },
                  },
                )
              }
            >
              {t("Relancer", "Remind")}
            </Bouton>
          </div>
        ) : null}
      </div>
      {f.erreurGlobale || annonce ? (
        <div className="mp-pleine-largeur">
          <RetourFormulaire
            erreur={f.erreurGlobale}
            succes={annonce}
            refAlerte={f.refAlerte}
            titreErreur={t(`Relance de ${r.nom} impossible`, `Could not remind ${r.nom}`)}
          />
        </div>
      ) : null}
    </li>
  );
}

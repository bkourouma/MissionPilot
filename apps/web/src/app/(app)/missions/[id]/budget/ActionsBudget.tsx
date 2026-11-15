"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../components/ui/CaseACocher";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { api } from "../../../../../lib/api";
import { validerRevision, type ActionsBudget as Actions } from "../../../../../lib/budget";

export interface ActionsBudgetProps {
  missionId: string;
  actions: Actions;
  enCoursId: string | null;
  enCoursLibelle: string | null;
}

/** Révision (motif obligatoire), validation selon les droits et abandon (FIN-03, FIN-15). */
export function ActionsBudget({
  missionId,
  actions,
  enCoursId,
  enCoursLibelle,
}: ActionsBudgetProps) {
  const t = useT();
  const langue = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [depuisDecoupage, setDepuisDecoupage] = useState(true);
  const f = useFormulaire<"motif">();
  const g = useFormulaire<never>();
  const base = `/api/missions/${encodeURIComponent(missionId)}/budget`;

  async function creer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRevision({ motif, depuis_decoupage: depuisDecoupage }, langue),
      (c) => api.post(`${base}/revisions`, c),
      {
        succes: t(
          "Révision créée : elle attend la validation du directeur de mission.",
          "Revision created: it is awaiting approval by the engagement director.",
        ),
        apres: () => {
          setOuvert(false);
          setMotif("");
        },
      },
    );
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={g.erreurGlobale}
        succes={g.succes}
        refAlerte={g.refAlerte}
        titreErreur={t("Action impossible", "Action not possible")}
      />
      <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
      {enCoursId && (actions.valider || actions.abandonner) ? (
        <div className="mp-barre-actions">
          {actions.valider ? (
            <BoutonConfirmation
              libelle={t(
                `Valider ${enCoursLibelle ?? "la révision"}`,
                `Approve ${enCoursLibelle ?? "the revision"}`,
              )}
              variante="primaire"
              icone="cadenas"
              question={t(
                "Valider et figer cette révision ? Elle deviendra le budget de référence ; l'initial reste dans l'historique.",
                "Approve and freeze this revision? It will become the baseline budget; the initial one stays in the history.",
              )}
              libelleConfirmation={t("Oui, valider et figer", "Yes, approve and freeze")}
              texteChargement={t("Validation…", "Approving…")}
              action={() =>
                g.envoyer(
                  { ok: true, charge: null },
                  () => api.post(`${base}/versions/${encodeURIComponent(enCoursId)}/valider`),
                  { succes: t("Révision validée et figée.", "Revision approved and frozen.") },
                )
              }
            />
          ) : null}
          {actions.abandonner ? (
            <BoutonConfirmation
              libelle={t("Abandonner la révision", "Abandon the revision")}
              icone="corbeille"
              question={t(
                "Abandonner cette révision en cours ? Elle sera supprimée ; les versions figées ne changent pas.",
                "Abandon this revision in progress? It will be deleted; frozen versions do not change.",
              )}
              libelleConfirmation={t("Oui, abandonner", "Yes, abandon")}
              texteChargement={t("Abandon…", "Abandoning…")}
              action={() =>
                g.envoyer(
                  { ok: true, charge: null },
                  () => api.supprimer(`${base}/versions/${encodeURIComponent(enCoursId)}`),
                  { succes: t("Révision abandonnée.", "Revision abandoned.") },
                )
              }
            />
          ) : null}
        </div>
      ) : null}
      {enCoursId && actions.raisonValidation ? (
        <p className="mp-texte-doux">{actions.raisonValidation}</p>
      ) : null}
      {actions.reviser ? (
        ouvert ? (
          <form
            ref={f.refFormulaire}
            className="mp-formulaire mp-sous-formulaire"
            noValidate
            onSubmit={creer}
            aria-label={t("Demander une révision du budget", "Request a budget revision")}
          >
            <p className="mp-sous-formulaire__titre">
              {t("Nouvelle révision du budget", "New budget revision")}
            </p>
            <RetourFormulaire
              erreur={f.erreurGlobale}
              refAlerte={f.refAlerte}
              titreErreur={t("Révision impossible", "Revision not possible")}
            />
            <ZoneTexte
              libelle={t("Motif de la révision", "Reason for the revision")}
              required
              maxLength={2000}
              rows={4}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              erreur={f.erreurs.motif}
              aide={t(
                "Obligatoire : avenant client, réallocation entre phases, dérive constatée…",
                "Required: client amendment, reallocation between phases, observed drift…",
              )}
            />
            <CaseACocher
              libelle={t(
                "Recalculer depuis le découpage actuel",
                "Recalculate from the current work breakdown",
              )}
              aide={t(
                "Les jours budgétés des tâches remplacent ceux de la référence (prix de la référence conservés). Sinon, la référence est reprise telle quelle.",
                "The budgeted days of the tasks replace those of the baseline (baseline prices kept). Otherwise, the baseline is carried over as is.",
              )}
              checked={depuisDecoupage}
              onChange={(e) => setDepuisDecoupage(e.target.checked)}
            />
            <div className="mp-actions-formulaire">
              <Bouton
                type="submit"
                chargement={f.enCours}
                texteChargement={t("Création…", "Creating…")}
              >
                {t("Créer la révision", "Create the revision")}
              </Bouton>
              <Bouton variante="discret" onClick={() => setOuvert(false)}>
                {t("Annuler", "Cancel")}
              </Bouton>
            </div>
          </form>
        ) : (
          <div>
            <Bouton variante="secondaire" icone="crayon" onClick={() => setOuvert(true)}>
              {t("Demander une révision", "Request a revision")}
            </Bouton>
          </div>
        )
      ) : actions.raison && !enCoursId ? (
        <p className="mp-texte-doux">{actions.raison}</p>
      ) : null}
    </div>
  );
}

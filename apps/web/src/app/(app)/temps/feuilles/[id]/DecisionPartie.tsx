"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { api } from "../../../../../lib/api";
import { validerMotif } from "../../../../../lib/temps";

/**
 * Décision sur une partie d'une feuille (une mission ou les activités internes) : valider, ou
 * rejeter avec un motif obligatoire transmis au collaborateur (TPS-03).
 */
export function DecisionPartie({
  feuilleId,
  missionId,
  intitule,
}: {
  feuilleId: string;
  missionId: string | null;
  intitule: string;
}) {
  const t = useT();
  const langue = useLangue();
  const [rejet, setRejet] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const base = `/api/feuilles-temps/${encodeURIComponent(feuilleId)}`;
  const partie = missionId ? { mission_id: missionId } : { interne: true as const };

  async function rejeter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerMotif(motif, langue),
      (c) => api.post(`${base}/rejeter`, { ...partie, ...c }),
      {
        succes: t(
          "Partie rejetée : le collaborateur est prévenu et peut corriger sa feuille.",
          "Part rejected: the employee is notified and can correct the timesheet.",
        ),
      },
    );
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Décision impossible", "Decision not possible")}
      />
      {rejet ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={rejeter}>
          <ZoneTexte
            libelle={t("Motif du rejet", "Reason for rejection")}
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide={t(
              "Précisez quoi corriger : le motif est envoyé au collaborateur.",
              "Say what to correct: the reason is sent to the employee.",
            )}
          />
          <div className="mp-barre-actions">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement={t("Rejet…", "Rejecting…")}
            >
              {t("Rejeter", "Reject")}
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setRejet(false)}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-barre-actions">
          <Bouton
            icone="succes"
            chargement={f.enCours}
            texteChargement={t("Validation…", "Approving…")}
            aria-label={t(`Valider : ${intitule}`, `Approve: ${intitule}`)}
            onClick={() =>
              f.envoyer({ ok: true, charge: partie }, (c) => api.post(`${base}/valider`, c), {
                succes: t("Partie validée.", "Part approved."),
              })
            }
          >
            {t("Valider", "Approve")}
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="fermer"
            aria-label={t(`Rejeter : ${intitule}`, `Reject: ${intitule}`)}
            onClick={() => setRejet(true)}
          >
            {t("Rejeter…", "Reject…")}
          </Bouton>
        </div>
      )}
    </div>
  );
}

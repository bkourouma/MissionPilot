"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { api } from "../../../../../lib/api";
import { validerMotif } from "../../../../../lib/temps";

type Etape = "repos" | "validation" | "rejet";

/**
 * Décision sur une partie d'une feuille (une mission ou les activités internes) : valider
 * (après confirmation), ou rejeter avec un motif obligatoire transmis au collaborateur (TPS-03).
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
  const [etape, setEtape] = useState<Etape>("repos");
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const refConfirmer = useRef<HTMLButtonElement>(null);
  const refValider = useRef<HTMLButtonElement>(null);
  const [rendreFocus, setRendreFocus] = useState(false);
  const base = `/api/feuilles-temps/${encodeURIComponent(feuilleId)}`;
  const partie = missionId ? { mission_id: missionId } : { interne: true as const };

  useEffect(() => {
    if (etape === "validation") refConfirmer.current?.focus();
    else if (etape === "repos" && rendreFocus) refValider.current?.focus();
  }, [etape, rendreFocus]);

  function revenir() {
    setRendreFocus(true);
    setEtape("repos");
  }

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

  async function valider() {
    await f.envoyer({ ok: true, charge: partie }, (c) => api.post(`${base}/valider`, c), {
      succes: t("Partie validée.", "Part approved."),
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Décision impossible", "Decision not possible")}
      />
      {etape === "rejet" ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={rejeter}
          aria-label={t(`Rejeter : ${intitule}`, `Reject: ${intitule}`)}
        >
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
              {t("Rejeter cette partie", "Reject this part")}
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={revenir}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      ) : etape === "validation" ? (
        <div
          className="mp-confirmation-decision"
          role="group"
          aria-label={t(`Confirmer la validation : ${intitule}`, `Confirm approval: ${intitule}`)}
        >
          <p className="mp-confirmation-decision__question">
            {t(
              `Valider les temps de « ${intitule} » ? Le collaborateur en sera informé.`,
              `Approve the time for "${intitule}"? The employee will be notified.`,
            )}
          </p>
          <div className="mp-barre-actions">
            <Bouton
              ref={refConfirmer}
              icone="succes"
              chargement={f.enCours}
              texteChargement={t("Validation…", "Approving…")}
              onClick={valider}
            >
              {t("Oui, valider", "Yes, approve")}
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={revenir}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="mp-barre-actions">
          <Bouton
            ref={refValider}
            icone="succes"
            aria-label={t(`Valider : ${intitule}`, `Approve: ${intitule}`)}
            onClick={() => {
              setRendreFocus(false);
              setEtape("validation");
            }}
          >
            {t("Valider", "Approve")}
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="fermer"
            aria-label={t(`Rejeter : ${intitule}`, `Reject: ${intitule}`)}
            onClick={() => setEtape("rejet")}
          >
            {t("Rejeter…", "Reject…")}
          </Bouton>
        </div>
      )}
    </div>
  );
}

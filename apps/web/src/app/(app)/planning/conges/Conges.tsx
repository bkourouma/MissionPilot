"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import {
  optionsTypesAbsence,
  SAISIE_ABSENCE_VIDE,
  TYPE_ABSENCE_LIBELLES,
  TYPE_ABSENCE_LIBELLES_EN,
  validerAbsence,
  type SaisieAbsence,
} from "../../../../lib/planification";
import { validerMotif } from "../../../../lib/temps";

/** Demande d'absence pour soi (PLN-07). */
export function DemandeAbsence({ aujourdhui }: { aujourdhui: string }) {
  const t = useT();
  const langue = useLangue();
  const [saisie, setSaisie] = useState<SaisieAbsence>(SAISIE_ABSENCE_VIDE);
  const f = useFormulaire<keyof SaisieAbsence>();
  const maj = (champ: keyof SaisieAbsence) => (v: string) =>
    setSaisie((s) => ({ ...s, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const typeLibelle = (langue === "en" ? TYPE_ABSENCE_LIBELLES_EN : TYPE_ABSENCE_LIBELLES)[
      saisie.type as keyof typeof TYPE_ABSENCE_LIBELLES
    ]?.toLowerCase();
    await f.envoyer(validerAbsence(saisie, langue), (c) => api.post("/api/absences", c), {
      succes: t(
        `Demande de ${typeLibelle ?? "absence"} envoyée : elle attend la validation du responsable des ressources.`,
        `${typeLibelle ?? "absence"} request sent: it is awaiting approval by the resources manager.`,
      ),
      apres: () => setSaisie(SAISIE_ABSENCE_VIDE),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Demander une absence", "Request an absence")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Demande impossible", "Request not possible")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Type d'absence", "Absence type")}
          name="type"
          required
          options={optionsTypesAbsence(langue)}
          value={saisie.type}
          onChange={(e) => maj("type")(e.target.value)}
          erreur={f.erreurs.type}
          aide={t(
            "Le type n'est visible que de vous et des valideurs des congés.",
            "The type is visible only to you and to leave approvers.",
          )}
        />
        <Champ
          libelle={t("Premier jour d'absence", "First day of absence")}
          type="date"
          name="date_debut"
          required
          min={aujourdhui}
          value={saisie.date_debut}
          onChange={(e) => {
            const v = e.target.value;
            setSaisie((s) => ({ ...s, date_debut: v, date_fin: s.date_fin || v }));
          }}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle={t("Dernier jour d'absence", "Last day of absence")}
          type="date"
          name="date_fin"
          required
          min={saisie.date_debut || aujourdhui}
          aide={t(
            "Identique au premier jour pour une seule journée.",
            "Same as the first day for a single day.",
          )}
          value={saisie.date_fin}
          onChange={(e) => maj("date_fin")(e.target.value)}
          erreur={f.erreurs.date_fin}
        />
      </div>
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
        name="commentaire"
        maxLength={500}
        value={saisie.commentaire}
        onChange={(e) => maj("commentaire")(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="envoyer"
          chargement={f.enCours}
          texteChargement={t("Envoi…", "Sending…")}
        >
          {t("Envoyer la demande", "Send request")}
        </Bouton>
      </div>
    </form>
  );
}

/** Annulation par le demandeur d'une absence qui n'a pas commencé. */
export function AnnulationAbsence({ id, libelle }: { id: string; libelle: string }) {
  const t = useT();
  const f = useFormulaire<never>();
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Annulation impossible", "Cancellation not possible")}
      />
      <BoutonConfirmation
        libelle={t("Annuler la demande", "Cancel the request")}
        ariaLabel={`${t("Annuler la demande", "Cancel the request")} : ${libelle}`}
        question={t(`Annuler cette demande (${libelle}) ?`, `Cancel this request (${libelle})?`)}
        libelleConfirmation={t("Oui, annuler", "Yes, cancel")}
        texteChargement={t("Annulation…", "Cancelling…")}
        icone="fermer"
        action={() =>
          f.envoyer({ ok: true, charge: null }, () =>
            api.post(`/api/absences/${encodeURIComponent(id)}/annuler`),
          )
        }
      />
    </div>
  );
}

/** Décision d'un valideur des congés : valider, ou refuser avec un motif obligatoire. */
export function DecisionAbsence({ id, libelle }: { id: string; libelle: string }) {
  const t = useT();
  const langue = useLangue();
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const base = `/api/absences/${encodeURIComponent(id)}`;

  async function refuser(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif, langue), (c) => api.post(`${base}/refuser`, c), {
      succes: t(
        "Demande refusée : le collaborateur est prévenu.",
        "Request rejected: the team member has been notified.",
      ),
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
      {refus ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={refuser}>
          <ZoneTexte
            libelle={t("Motif du refus", "Reason for rejection")}
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide={t(
              "Le motif est transmis au collaborateur.",
              "The reason is passed on to the team member.",
            )}
          />
          <div className="mp-barre-actions">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement={t("Refus…", "Rejecting…")}
            >
              {t("Refuser la demande", "Reject the request")}
            </Bouton>
            <Bouton variante="secondaire" onClick={() => setRefus(false)} disabled={f.enCours}>
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
            aria-label={`${t("Valider la demande", "Approve the request")} : ${libelle}`}
            onClick={() =>
              f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/valider`), {
                succes: t(
                  "Demande validée : la capacité du collaborateur est mise à jour.",
                  "Request approved: the team member's capacity is updated.",
                ),
              })
            }
          >
            {t("Valider", "Approve")}
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="fermer"
            aria-label={`${t("Refuser la demande", "Reject the request")} : ${libelle}`}
            onClick={() => setRefus(true)}
          >
            {t("Refuser…", "Reject…")}
          </Bouton>
        </div>
      )}
    </div>
  );
}

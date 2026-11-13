"use client";

import { useState, type FormEvent } from "react";
import type { SaisieKpiApi } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminSaisieKpi,
  messageErreurCanaux,
  peutRejeterSaisie,
  peutReprendreSaisie,
  validerRejetSaisie,
  validerRepriseSaisie,
} from "../../lib/canaux";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import "./canaux.css";

export interface ActionsSaisieKpiProps {
  saisie: Pick<SaisieKpiApi, "id" | "kpi_libelle" | "statut" | "date_mesure">;
}

type Panneau = "reprendre" | "rejeter" | null;

/**
 * « Reprendre dans le KPI » (la mesure n'est écrite que par un utilisateur du cabinet, sous son
 * identité, avec une date de mesure modifiable) ou « Rejeter » (motif obligatoire).
 */
export function ActionsSaisieKpi({ saisie }: ActionsSaisieKpiProps) {
  const t = useT();
  const [panneau, setPanneau] = useState<Panneau>(null);
  if (!peutReprendreSaisie(saisie) && !peutRejeterSaisie(saisie)) {
    return <span className="mp-texte-doux">{t("Aucune action", "No action")}</span>;
  }
  return (
    <div>
      <div className="mp-canaux__actions-ligne">
        <Bouton
          variante="primaire"
          aria-expanded={panneau === "reprendre"}
          aria-label={t(
            `Reprendre la saisie de ${saisie.kpi_libelle} dans le KPI`,
            `Take up the entry for ${saisie.kpi_libelle} into the KPI`,
          )}
          onClick={() => setPanneau(panneau === "reprendre" ? null : "reprendre")}
        >
          {t("Reprendre dans le KPI", "Take up into the KPI")}
        </Bouton>
        <Bouton
          variante="secondaire"
          aria-expanded={panneau === "rejeter"}
          aria-label={t(
            `Rejeter la saisie de ${saisie.kpi_libelle}`,
            `Reject the entry for ${saisie.kpi_libelle}`,
          )}
          onClick={() => setPanneau(panneau === "rejeter" ? null : "rejeter")}
        >
          {t("Rejeter", "Reject")}
        </Bouton>
      </div>
      {panneau === "reprendre" ? (
        <FormulaireReprise saisie={saisie} onFin={() => setPanneau(null)} />
      ) : null}
      {panneau === "rejeter" ? (
        <FormulaireRejet saisie={saisie} onFin={() => setPanneau(null)} />
      ) : null}
    </div>
  );
}

function FormulaireReprise({
  saisie,
  onFin,
}: {
  saisie: ActionsSaisieKpiProps["saisie"];
  onFin: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [date, setDate] = useState(saisie.date_mesure);
  const [commentaire, setCommentaire] = useState("");
  const f = useFormulaire<"date_mesure" | "commentaire">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRepriseSaisie({ date_mesure: date, commentaire }, langue),
      (charge) =>
        api.post(cheminSaisieKpi(saisie.id, "reprendre"), charge, { redirigerSi401: false }),
      {
        succes: t(
          "Saisie reprise : la mesure est enregistrée dans l'indicateur.",
          "Entry taken up: the measure is recorded in the KPI.",
        ),
        messageSpecifique: (e) => messageErreurCanaux(e, "totp", langue),
        apres: onFin,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        `Reprise de la saisie de ${saisie.kpi_libelle}`,
        `Taking up the entry for ${saisie.kpi_libelle}`,
      )}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        {t(
          "La valeur reçue par message, confirmée par la personne, devient une mesure de l'indicateur sous votre identité.",
          "The value received by message, confirmed by the person, becomes a measure of the KPI under your identity.",
        )}
      </p>
      <Champ
        libelle={t("Date de la mesure", "Measurement date")}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        erreur={f.erreurs.date_mesure}
        min="2000-01-01"
        max="2100-12-31"
      />
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
        maxLength={500}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Reprendre la mesure", "Take up the measure")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireRejet({
  saisie,
  onFin,
}: {
  saisie: ActionsSaisieKpiProps["saisie"];
  onFin: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRejetSaisie(motif, langue),
      (charge) =>
        api.post(cheminSaisieKpi(saisie.id, "rejeter"), charge, { redirigerSi401: false }),
      {
        succes: t("Saisie rejetée.", "Entry rejected."),
        messageSpecifique: (e) => messageErreurCanaux(e, "totp", langue),
        apres: onFin,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        `Rejet de la saisie de ${saisie.kpi_libelle}`,
        `Rejection of the entry for ${saisie.kpi_libelle}`,
      )}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle={t("Motif du rejet", "Reason for rejection")}
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={f.enCours}
          texteChargement={t("Rejet…", "Rejecting…")}
        >
          {t("Rejeter la saisie", "Reject the entry")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import {
  cheminMesuresKpi,
  libelleNature,
  messageKpi,
  type DetailKpi,
  type MesureKpi,
} from "../../lib/kpi";
import {
  COMMENTAIRE_MAX,
  dateMesureMax,
  JUSTIFICATIF_MAX,
  validerMesure,
  type ChampMesure,
  type SaisieMesure as Saisie,
} from "../../lib/kpi-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface SaisieMesureProps {
  kpi: Pick<DetailKpi, "id" | "unite" | "nature" | "debut_suivi" | "fin_suivi">;
  aujourdhui: string;
}

const VIDE = { valeur: "", commentaire: "", justificatif: "", motif: "" };

/**
 * Saisie d'une mesure datée (KPI-02) côté cabinet : la date doit tomber dans la période de
 * suivi, au plus tard aujourd'hui ; une seule mesure active par date (sinon : corriger).
 * L'API évalue ensuite les alertes du KPI.
 */
export function SaisieMesure({ kpi, aujourdhui }: SaisieMesureProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampMesure>();
  const max = dateMesureMax(kpi, aujourdhui);
  const [s, setS] = useState<Saisie>({ date_mesure: max, ...VIDE });
  const maj = (cle: keyof Saisie) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerMesure(s, kpi, aujourdhui, langue),
      (charge) => api.post<MesureKpi>(cheminMesuresKpi(kpi.id), charge),
      {
        succes: t(
          "Mesure enregistrée : le statut et les alertes du KPI ont été réévalués.",
          "Measurement saved: the KPI's status and alerts have been reassessed.",
        ),
        messageSpecifique: (e) => messageKpi(e, langue),
      },
    );
    if (ok) setS((x) => ({ ...x, ...VIDE }));
  }

  if (kpi.debut_suivi > max) {
    return (
      <p className="mp-texte-doux">
        {t(
          `Le suivi commence le ${formaterDate(kpi.debut_suivi, "UTC", langue)} : aucune mesure ne peut encore être datée.`,
          `Tracking starts on ${formaterDate(kpi.debut_suivi, "UTC", langue)}: no measurement can be dated yet.`,
        )}
      </p>
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Saisir une mesure", "Enter a measurement")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Mesure refusée", "Measurement refused")}
      />
      <p className="mp-texte-doux">{libelleNature(kpi.nature, langue)}.</p>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Date de la mesure", "Measurement date")}
          type="date"
          required
          min={kpi.debut_suivi}
          max={max}
          value={s.date_mesure}
          onChange={maj("date_mesure")}
          erreur={f.erreurs.date_mesure}
          aide={t(
            `Du ${formaterDate(kpi.debut_suivi, "UTC", langue)} au ${formaterDate(max, "UTC", langue)}.`,
            `From ${formaterDate(kpi.debut_suivi, "UTC", langue)} to ${formaterDate(max, "UTC", langue)}.`,
          )}
        />
        <Champ
          libelle={`${t("Valeur", "Value")} (${kpi.unite})`}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.valeur}
          onChange={maj("valeur")}
          erreur={f.erreurs.valeur}
          aide={t(
            "15 chiffres significatifs et 6 décimales au plus (ex. 1 250,5).",
            "15 significant digits and 6 decimals at most (e.g. 1250.5).",
          )}
        />
      </div>
      <ZoneTexte
        libelle={t("Commentaire", "Comment")}
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle={t("Justificatif", "Supporting document")}
        maxLength={JUSTIFICATIF_MAX}
        value={s.justificatif}
        onChange={maj("justificatif")}
        erreur={f.erreurs.justificatif}
        aide={t(
          "Référence de la pièce (ex. « Balance générale au 31/01 »).",
          'Reference of the document (e.g. "General ledger balance at 31/01").',
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la mesure", "Save the measurement")}
        </Bouton>
      </div>
    </form>
  );
}

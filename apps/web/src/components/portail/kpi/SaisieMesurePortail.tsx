"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { formaterDate, libelleUnite } from "../../../lib/format";
import {
  COMMENTAIRE_MAX,
  dateMesureMax,
  JUSTIFICATIF_MAX,
  validerMesure,
  type ChampMesure,
  type SaisieMesure,
} from "../../../lib/kpi-saisie";
import {
  cheminApiSaisieMesure,
  libelleNature,
  messagePortailKpi,
  type KpiPortail,
  type MesurePortail,
} from "../../../lib/portail-kpi";
import { RetourFormulaire } from "../../formulaires/RetourFormulaire";
import { useLangue, useT } from "../../i18n/FournisseurLangue";
import { useFormulaire } from "../../formulaires/useFormulaire";
import { Bouton } from "../../ui/Bouton";
import { Champ } from "../../ui/Champ";
import { ZoneTexte } from "../../ui/ZoneTexte";

const VIDE = { valeur: "", commentaire: "", justificatif: "", motif: "" };

/**
 * Saisie d'une mesure datée par un contributeur du client : la date tombe dans la période de
 * suivi, au plus tard aujourd'hui ; une seule mesure active par date (sinon : la corriger dans
 * l'historique). L'API juge ensuite (KPI désigné, mission ouverte) et le cabinet est alerté.
 */
export function SaisieMesurePortail({
  kpi,
  aujourdhui,
}: {
  kpi: Pick<KpiPortail, "id" | "unite" | "nature" | "debut_suivi" | "fin_suivi">;
  aujourdhui: string;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampMesure>();
  const max = dateMesureMax(kpi, aujourdhui);
  const [s, setS] = useState<SaisieMesure>({ date_mesure: max, ...VIDE });
  const maj = (cle: keyof SaisieMesure) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerMesure(s, kpi, aujourdhui, langue),
      (charge) => api.post<MesurePortail>(cheminApiSaisieMesure(kpi.id), charge),
      {
        succes: t(
          "Mesure enregistrée. Votre cabinet en est informé.",
          "Measurement saved. Your firm has been notified.",
        ),
        messageSpecifique: (err) => messagePortailKpi(err, langue),
      },
    );
    if (ok) setS((x) => ({ ...x, ...VIDE }));
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
      <p className="mp-texte-doux">{libelleNature(kpi.nature, langue)}</p>
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
          libelle={
            kpi.unite
              ? `${t("Valeur", "Value")} (${libelleUnite(kpi.unite)})`
              : t("Valeur", "Value")
          }
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.valeur}
          onChange={maj("valeur")}
          erreur={f.erreurs.valeur}
          aide={t(
            "Au plus 15 chiffres, dont 6 décimales (ex. 1 250,5).",
            "At most 15 digits, including 6 decimals (e.g. 1250.5).",
          )}
        />
      </div>
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle={t("Justificatif (facultatif)", "Supporting document (optional)")}
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

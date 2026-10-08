"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { formaterDate } from "../../../lib/format";
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
  const f = useFormulaire<ChampMesure>();
  const max = dateMesureMax(kpi, aujourdhui);
  const [s, setS] = useState<SaisieMesure>({ date_mesure: max, ...VIDE });
  const maj = (cle: keyof SaisieMesure) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerMesure(s, kpi, aujourdhui),
      (charge) => api.post<MesurePortail>(cheminApiSaisieMesure(kpi.id), charge),
      {
        succes: "Mesure enregistrée. Votre cabinet en est informé.",
        messageSpecifique: messagePortailKpi,
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
      aria-label="Saisir une mesure"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Mesure refusée"
      />
      <p className="mp-texte-doux">{libelleNature(kpi.nature)}</p>
      <div className="mp-grille-champs">
        <Champ
          libelle="Date de la mesure"
          type="date"
          required
          min={kpi.debut_suivi}
          max={max}
          value={s.date_mesure}
          onChange={maj("date_mesure")}
          erreur={f.erreurs.date_mesure}
          aide={`Du ${formaterDate(kpi.debut_suivi)} au ${formaterDate(max)}.`}
        />
        <Champ
          libelle={kpi.unite ? `Valeur (${kpi.unite})` : "Valeur"}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.valeur}
          onChange={maj("valeur")}
          erreur={f.erreurs.valeur}
          aide="Au plus 15 chiffres, dont 6 décimales (ex. 1 250,5)."
        />
      </div>
      <ZoneTexte
        libelle="Commentaire (facultatif)"
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle="Justificatif (facultatif)"
        maxLength={JUSTIFICATIF_MAX}
        value={s.justificatif}
        onChange={maj("justificatif")}
        erreur={f.erreurs.justificatif}
        aide="Référence de la pièce (ex. « Balance générale au 31/01 »)."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la mesure
        </Bouton>
      </div>
    </form>
  );
}

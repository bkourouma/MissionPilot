"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import {
  cheminMesuresKpi,
  messageKpi,
  NATURE_LIBELLES,
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
  const f = useFormulaire<ChampMesure>();
  const max = dateMesureMax(kpi, aujourdhui);
  const [s, setS] = useState<Saisie>({ date_mesure: max, ...VIDE });
  const maj = (cle: keyof Saisie) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerMesure(s, kpi, aujourdhui),
      (charge) => api.post<MesureKpi>(cheminMesuresKpi(kpi.id), charge),
      {
        succes: "Mesure enregistrée : le statut et les alertes du KPI ont été réévalués.",
        messageSpecifique: messageKpi,
      },
    );
    if (ok) setS((x) => ({ ...x, ...VIDE }));
  }

  if (kpi.debut_suivi > max) {
    return (
      <p className="mp-texte-doux">
        {`Le suivi commence le ${formaterDate(kpi.debut_suivi)} : aucune mesure ne peut encore être datée.`}
      </p>
    );
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
      <p className="mp-texte-doux">{NATURE_LIBELLES[kpi.nature]}.</p>
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
          libelle={`Valeur (${kpi.unite})`}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.valeur}
          onChange={maj("valeur")}
          erreur={f.erreurs.valeur}
          aide="15 chiffres significatifs et 6 décimales au plus (ex. 1 250,5)."
        />
      </div>
      <ZoneTexte
        libelle="Commentaire"
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle="Justificatif"
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

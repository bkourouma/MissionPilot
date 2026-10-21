"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  RED_SUIVI_TYPE_EVENEMENT_LIBELLES,
  type RedSuiviTypeEvenement,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminEvenementsJalon, messageSuivi } from "../../lib/redressement-suivi";
import {
  corpsEvenement,
  type ChampEvenement,
  type SaisieEvenement,
} from "../../lib/redressement-suivi-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const TYPES: RedSuiviTypeEvenement[] = ["realise", "reporte"];

/**
 * Marquer un jalon réalisé (date de réalisation) ou le reporter (nouvelle date prévue, motif
 * obligatoire). L'API juge ce qui est possible (jalon déjà réalisé, plafond de reports).
 */
export function SuiviEvenementForm({
  dossierId,
  jalonId,
  aujourdhui,
}: {
  dossierId: string;
  jalonId: string;
  aujourdhui: string;
}) {
  const f = useFormulaire<ChampEvenement>();
  const [s, setS] = useState<SaisieEvenement>({
    type: "realise",
    date_effet: aujourdhui,
    motif: "",
  });
  const verrou = useRef(false);
  const reporte = s.type === "reporte";

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verrou.current) return;
    verrou.current = true;
    try {
      await f.envoyer(
        corpsEvenement(s),
        (charge) => api.post(cheminEvenementsJalon(dossierId, jalonId), charge),
        {
          succes: reporte ? "Jalon reporté." : "Jalon marqué comme réalisé.",
          messageSpecifique: messageSuivi,
          apres: () => setS((x) => ({ ...x, motif: "" })),
        },
      );
    } finally {
      verrou.current = false;
    }
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Réaliser ou reporter ce jalon"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Mise à jour impossible"
      />
      <Select
        libelle="Action sur le jalon"
        value={s.type}
        onChange={(e) => setS({ ...s, type: e.target.value as RedSuiviTypeEvenement })}
        options={TYPES.map((t) => ({ valeur: t, libelle: RED_SUIVI_TYPE_EVENEMENT_LIBELLES[t] }))}
      />
      <Champ
        libelle={reporte ? "Nouvelle date prévue" : "Date de réalisation"}
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        value={s.date_effet}
        onChange={(e) => setS({ ...s, date_effet: e.target.value })}
        erreur={f.erreurs.date_effet}
        required
      />
      <ZoneTexte
        libelle={reporte ? "Motif du report" : "Commentaire (facultatif)"}
        value={s.motif}
        onChange={(e) => setS({ ...s, motif: e.target.value })}
        erreur={f.erreurs.motif}
        required={reporte}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          {reporte ? "Reporter le jalon" : "Marquer comme réalisé"}
        </Bouton>
      </div>
    </form>
  );
}

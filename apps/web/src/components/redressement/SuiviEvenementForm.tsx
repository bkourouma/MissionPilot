"use client";

import { useRef, useState, type FormEvent } from "react";
import type { RedSuiviTypeEvenement } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminEvenementsJalon,
  libelleTypeEvenementSuivi,
  messageSuivi,
} from "../../lib/redressement-suivi";
import {
  corpsEvenement,
  type ChampEvenement,
  type SaisieEvenement,
} from "../../lib/redressement-suivi-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
        corpsEvenement(s, langue),
        (charge) => api.post(cheminEvenementsJalon(dossierId, jalonId), charge),
        {
          succes: reporte
            ? t("Jalon reporté.", "Milestone postponed.")
            : t("Jalon marqué comme réalisé.", "Milestone marked as completed."),
          messageSpecifique: (e) => messageSuivi(e, langue),
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
      aria-label={t("Réaliser ou reporter ce jalon", "Complete or postpone this milestone")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Mise à jour impossible", "Update not possible")}
      />
      <Select
        libelle={t("Action sur le jalon", "Action on the milestone")}
        value={s.type}
        onChange={(e) => setS({ ...s, type: e.target.value as RedSuiviTypeEvenement })}
        options={TYPES.map((v) => ({ valeur: v, libelle: libelleTypeEvenementSuivi(v, langue) }))}
      />
      <Champ
        libelle={
          reporte
            ? t("Nouvelle date prévue", "New planned date")
            : t("Date de réalisation", "Completion date")
        }
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        value={s.date_effet}
        onChange={(e) => setS({ ...s, date_effet: e.target.value })}
        erreur={f.erreurs.date_effet}
        required
      />
      <ZoneTexte
        libelle={
          reporte
            ? t("Motif du report", "Reason for postponement")
            : t("Commentaire (facultatif)", "Comment (optional)")
        }
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
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {reporte
            ? t("Reporter le jalon", "Postpone the milestone")
            : t("Marquer comme réalisé", "Mark as completed")}
        </Bouton>
      </div>
    </form>
  );
}

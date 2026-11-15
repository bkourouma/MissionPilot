"use client";

import { useState, type FormEvent } from "react";
import type { RedScoreVue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminScores, messageRedressement } from "../../lib/redressement";
import {
  corpsScoreDepuisFormulaire,
  saisieIncidentsDepuis,
  type ChampIncidents,
  type ReponseTernaire,
  type SaisieIncidents,
} from "../../lib/redressement-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

/**
 * Incidents de paiement (rejets bancaires, fournisseurs payés très en retard, arriérés d'impôts
 * ou de cotisations) puis « Calculer le score ». Un champ laissé vide ou « Inconnu » rend le
 * critère « Non renseigné » : il n'est jamais compté comme zéro. Le calcul est celui du moteur.
 */
export function FormulaireIncidents({
  dossierId,
  derniers,
}: {
  dossierId: string;
  derniers: RedScoreVue["entrees"]["incidents"] | null;
}) {
  const t = useT();
  const langue = useLangue();
  const OPTIONS_TERNAIRE = [
    { valeur: "oui", libelle: t("Oui", "Yes") },
    { valeur: "non", libelle: t("Non", "No") },
    { valeur: "inconnu", libelle: t("Inconnu", "Unknown") },
  ];
  const f = useFormulaire<ChampIncidents>();
  const [s, setS] = useState<SaisieIncidents>(() => saisieIncidentsDepuis(derniers));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsScoreDepuisFormulaire(s, langue),
      (charge) => api.post<RedScoreVue>(cheminScores(dossierId), charge),
      {
        succes: t("Score calculé.", "Score computed."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Incidents de paiement", "Payment incidents")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Calcul impossible", "Could not compute")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Rejets bancaires sur 12 mois", "Bank rejections over 12 months")}
          inputMode="numeric"
          autoComplete="off"
          value={s.rejets}
          onChange={(e) => setS((x) => ({ ...x, rejets: e.target.value }))}
          erreur={f.erreurs.rejets}
          aide={t(
            "Nombre de chèques ou prélèvements rejetés. Laisser vide si inconnu.",
            "Number of rejected checks or direct debits. Leave empty if unknown.",
          )}
        />
        <Champ
          libelle={t(
            "Fournisseurs payés avec plus de 90 jours de retard",
            "Suppliers paid more than 90 days late",
          )}
          inputMode="numeric"
          autoComplete="off"
          value={s.retards}
          onChange={(e) => setS((x) => ({ ...x, retards: e.target.value }))}
          erreur={f.erreurs.retards}
          aide={t(
            "Nombre de fournisseurs concernés. Laisser vide si inconnu.",
            "Number of suppliers concerned. Leave empty if unknown.",
          )}
        />
        <Select
          libelle={t("Arriérés d'impôts ou de cotisations", "Tax or social contribution arrears")}
          value={s.arrieres}
          onChange={(e) => setS((x) => ({ ...x, arrieres: e.target.value as ReponseTernaire }))}
          options={OPTIONS_TERNAIRE}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Calcul…", "Computing…")}>
          {t("Calculer le score", "Compute the score")}
        </Bouton>
      </div>
    </form>
  );
}

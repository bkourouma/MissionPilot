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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

const OPTIONS_TERNAIRE = [
  { valeur: "oui", libelle: "Oui" },
  { valeur: "non", libelle: "Non" },
  { valeur: "inconnu", libelle: "Inconnu" },
];

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
  const f = useFormulaire<ChampIncidents>();
  const [s, setS] = useState<SaisieIncidents>(() => saisieIncidentsDepuis(derniers));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsScoreDepuisFormulaire(s),
      (charge) => api.post<RedScoreVue>(cheminScores(dossierId), charge),
      { succes: "Score calculé.", messageSpecifique: messageRedressement },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Incidents de paiement"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Calcul impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Rejets bancaires sur 12 mois"
          inputMode="numeric"
          autoComplete="off"
          value={s.rejets}
          onChange={(e) => setS((x) => ({ ...x, rejets: e.target.value }))}
          erreur={f.erreurs.rejets}
          aide="Nombre de chèques ou prélèvements rejetés. Laisser vide si inconnu."
        />
        <Champ
          libelle="Fournisseurs payés avec plus de 90 jours de retard"
          inputMode="numeric"
          autoComplete="off"
          value={s.retards}
          onChange={(e) => setS((x) => ({ ...x, retards: e.target.value }))}
          erreur={f.erreurs.retards}
          aide="Nombre de fournisseurs concernés. Laisser vide si inconnu."
        />
        <Select
          libelle="Arriérés d'impôts ou de cotisations"
          value={s.arrieres}
          onChange={(e) => setS((x) => ({ ...x, arrieres: e.target.value as ReponseTernaire }))}
          options={OPTIONS_TERNAIRE}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Calcul…">
          Calculer le score
        </Bouton>
      </div>
    </form>
  );
}

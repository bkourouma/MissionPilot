"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import { cheminCiblesKpi, FREQUENCE_LIBELLES, messageKpi, type DetailKpi } from "../../lib/kpi";
import { MOTIF_MAX, validerCible, type ChampCible, type SaisieCible } from "../../lib/kpi-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireCibleProps {
  kpi: Pick<DetailKpi, "id" | "unite" | "frequence" | "debut_suivi">;
  aujourdhui: string;
}

/**
 * Nouvelle version de cible (historique en ajout seul) : valeur ou « sans cible », date
 * d'application (ramenée par l'API au premier jour de sa période) et motif. Une cible ne se
 * modifie jamais : on en publie une nouvelle version.
 */
export function FormulaireCible({ kpi, aujourdhui }: FormulaireCibleProps) {
  const f = useFormulaire<ChampCible>();
  const [s, setS] = useState<SaisieCible>({
    valeur: "",
    sans_cible: false,
    a_partir_de: aujourdhui < kpi.debut_suivi ? kpi.debut_suivi : aujourdhui,
    motif: "",
  });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerCible(s, kpi),
      (charge) => api.post<DetailKpi>(cheminCiblesKpi(kpi.id), charge),
      {
        succes:
          "Nouvelle version de cible enregistrée : le moteur réévalue les périodes concernées.",
        messageSpecifique: messageKpi,
      },
    );
    if (ok) setS((x) => ({ ...x, valeur: "", sans_cible: false, motif: "" }));
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvelle version de cible"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Cible refusée"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={`Cible (${kpi.unite})`}
          inputMode="decimal"
          autoComplete="off"
          disabled={s.sans_cible}
          required={!s.sans_cible}
          value={s.valeur}
          onChange={(e) => setS((x) => ({ ...x, valeur: e.target.value }))}
          erreur={f.erreurs.valeur}
          aide="15 chiffres significatifs et 6 décimales au plus."
        />
        <Champ
          libelle="Applicable à partir du"
          type="date"
          required
          min={kpi.debut_suivi}
          value={s.a_partir_de}
          onChange={(e) => setS((x) => ({ ...x, a_partir_de: e.target.value }))}
          erreur={f.erreurs.a_partir_de}
          aide={`Ramenée au premier jour de sa période (${FREQUENCE_LIBELLES[kpi.frequence].toLowerCase()}) ; pas avant le ${formaterDate(kpi.debut_suivi)}.`}
        />
      </div>
      <CaseACocher
        libelle="Sans cible à partir de cette date"
        aide="Les périodes concernées passent au statut « Sans cible » et sortent du score composite."
        checked={s.sans_cible}
        onChange={(e) => setS((x) => ({ ...x, sans_cible: e.target.checked }))}
      />
      <ZoneTexte
        libelle="Motif"
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
        aide="Facultatif : révision budgétaire, nouvel objectif du comité… Conservé dans l'historique."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Publier cette version de cible
        </Bouton>
      </div>
    </form>
  );
}

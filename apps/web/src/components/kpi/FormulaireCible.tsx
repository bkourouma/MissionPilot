"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import { cheminCiblesKpi, libelleFrequence, messageKpi, type DetailKpi } from "../../lib/kpi";
import { MOTIF_MAX, validerCible, type ChampCible, type SaisieCible } from "../../lib/kpi-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
      validerCible(s, kpi, langue),
      (charge) => api.post<DetailKpi>(cheminCiblesKpi(kpi.id), charge),
      {
        succes: t(
          "Nouvelle version de cible enregistrée : le moteur réévalue les périodes concernées.",
          "New target version saved: the engine reassesses the periods concerned.",
        ),
        messageSpecifique: (e) => messageKpi(e, langue),
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
      aria-label={t("Nouvelle version de cible", "New target version")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Cible refusée", "Target refused")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={`${t("Cible", "Target")} (${kpi.unite})`}
          inputMode="decimal"
          autoComplete="off"
          disabled={s.sans_cible}
          required={!s.sans_cible}
          value={s.valeur}
          onChange={(e) => setS((x) => ({ ...x, valeur: e.target.value }))}
          erreur={f.erreurs.valeur}
          aide={t(
            "15 chiffres significatifs et 6 décimales au plus.",
            "15 significant digits and 6 decimals at most.",
          )}
        />
        <Champ
          libelle={t("Applicable à partir du", "Effective from")}
          type="date"
          required
          min={kpi.debut_suivi}
          value={s.a_partir_de}
          onChange={(e) => setS((x) => ({ ...x, a_partir_de: e.target.value }))}
          erreur={f.erreurs.a_partir_de}
          aide={t(
            `Ramenée au premier jour de sa période (${libelleFrequence(kpi.frequence, langue).toLowerCase()}) ; pas avant le ${formaterDate(kpi.debut_suivi, "UTC", langue)}.`,
            `Moved back to the first day of its period (${libelleFrequence(kpi.frequence, langue).toLowerCase()}); not before ${formaterDate(kpi.debut_suivi, "UTC", langue)}.`,
          )}
        />
      </div>
      <CaseACocher
        libelle={t("Sans cible à partir de cette date", "No target from this date")}
        aide={t(
          "Les périodes concernées passent au statut « Sans cible » et sortent du score composite.",
          'The periods concerned move to the "No target" status and leave the composite score.',
        )}
        checked={s.sans_cible}
        onChange={(e) => setS((x) => ({ ...x, sans_cible: e.target.checked }))}
      />
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
        aide={t(
          "Facultatif : révision budgétaire, nouvel objectif du comité… Conservé dans l'historique.",
          "Optional: budget revision, new committee objective… Kept in the history.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Publier cette version de cible", "Publish this target version")}
        </Bouton>
      </div>
    </form>
  );
}

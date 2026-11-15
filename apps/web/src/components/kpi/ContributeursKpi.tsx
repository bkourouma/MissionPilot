"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminContributeursKpi,
  MAX_CONTRIBUTEURS_KPI,
  messageKpi,
  type CandidatContributeur,
  type DetailKpi,
} from "../../lib/kpi";
import { validerContributeurs } from "../../lib/kpi-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";

export interface ContributeursKpiProps {
  kpiId: string;
  candidats: readonly CandidatContributeur[];
  /** Identifiants des contributeurs actuellement désignés. */
  actuels: readonly string[];
}

/**
 * Contributeurs du client (dirigeants et contributeurs du portail du MÊME client) autorisés à
 * saisir les mesures de ce KPI depuis le portail : partage explicite, remplacement complet de
 * la liste. Les alertes internes ne leur sont jamais envoyées.
 */
export function ContributeursKpi({ kpiId, candidats, actuels }: ContributeursKpiProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"utilisateurs">();
  const [choisis, setChoisis] = useState<string[]>([...actuels]);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerContributeurs(
        choisis,
        candidats.map((c) => c.id),
        langue,
      ),
      (charge) => api.put<DetailKpi>(cheminContributeursKpi(kpiId), charge),
      {
        succes:
          choisis.length === 0
            ? t(
                "Plus aucun contributeur du client ne peut saisir ce KPI.",
                "No client contributor can enter this KPI anymore.",
              )
            : t(
                `Contributeurs enregistrés : ${choisis.length} personne${choisis.length > 1 ? "s" : ""} du client peu${choisis.length > 1 ? "vent" : "t"} saisir ce KPI depuis le portail.`,
                `Contributors saved: ${choisis.length} client ${choisis.length > 1 ? "people" : "person"} can enter this KPI from the portal.`,
              ),
        messageSpecifique: (e) => messageKpi(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Contributeurs du client", "Client contributors")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Contributeurs refusés", "Contributors refused")}
      />
      <fieldset
        className={f.erreurs.utilisateurs ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}
        aria-invalid={f.erreurs.utilisateurs ? true : undefined}
      >
        <legend className="mp-champ__libelle">
          {t("Comptes du portail du client", "Client portal accounts")} ({MAX_CONTRIBUTEURS_KPI}{" "}
          {t("au plus", "at most")})
        </legend>
        <div className="mp-groupe__options">
          {candidats.map((c) => (
            <CaseACocher
              key={c.id}
              name="contributeurs"
              value={c.id}
              libelle={`${c.nom} — ${c.role}${c.desactive ? t(" (compte désactivé)", " (account disabled)") : ""}`}
              aide={c.email}
              checked={choisis.includes(c.id)}
              onChange={(e) =>
                setChoisis((x) => (e.target.checked ? [...x, c.id] : x.filter((id) => id !== c.id)))
              }
            />
          ))}
        </div>
        {f.erreurs.utilisateurs ? (
          <p className="mp-champ__erreur">{f.erreurs.utilisateurs}</p>
        ) : null}
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer les contributeurs", "Save contributors")}
        </Bouton>
      </div>
    </form>
  );
}

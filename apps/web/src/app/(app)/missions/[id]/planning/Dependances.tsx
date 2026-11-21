"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Champ } from "../../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { api } from "../../../../../lib/api";
import { validerDependance } from "../../../../../lib/decoupage";
import { formaterNombre } from "../../../../../lib/format";

export interface DependancesProps {
  missionId: string;
  dependances: {
    id: string;
    predecesseur: string;
    successeur: string;
    decalage: number;
  }[];
  taches: readonly OptionSelect[];
  modifiable: boolean;
}

type Champs = "predecesseur_id" | "successeur_id" | "decalage";

/** Dépendances fin → début (PLN-03) ; un cycle est refusé par le moteur de l'API. */
export function Dependances({ missionId, dependances, taches, modifiable }: DependancesProps) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState({ predecesseur_id: "", successeur_id: "", decalage: "0" });
  const f = useFormulaire<Champs>();
  const suppr = useFormulaire<never>();
  const base = `/api/missions/${encodeURIComponent(missionId)}/dependances`;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerDependance(s, langue), (c) => api.post(base, c), {
      succes: t(
        "Dépendance ajoutée : le planning est recalculé.",
        "Dependency added: the schedule is recalculated.",
      ),
      apres: () => setS({ predecesseur_id: "", successeur_id: "", decalage: "0" }),
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={suppr.erreurGlobale}
        succes={suppr.succes}
        refAlerte={suppr.refAlerte}
        titreErreur={t("Suppression impossible", "Could not delete")}
      />
      {dependances.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucune dépendance : chaque tâche démarre au plus tôt.",
            "No dependencies: each task starts as early as possible.",
          )}
        </p>
      ) : (
        <ul className="mp-liste-lignes">
          {dependances.map((d) => (
            <li key={d.id} className="mp-liste-lignes__ligne">
              <span className="mp-liste-lignes__texte mp-coupure">
                <span>
                  <strong>{d.successeur}</strong>{" "}
                  {t("commence après la fin de", "starts after the end of")}{" "}
                  <strong>{d.predecesseur}</strong>
                </span>
                {d.decalage !== 0 ? (
                  <span className="mp-texte-doux">
                    {t(
                      `Décalage : ${d.decalage > 0 ? "+" : "−"}${formaterNombre(Math.abs(d.decalage), 0)} jour(s) ouvré(s)`,
                      `Offset: ${d.decalage > 0 ? "+" : "−"}${formaterNombre(Math.abs(d.decalage), 0, langue)} business day(s)`,
                    )}
                  </span>
                ) : null}
              </span>
              {modifiable ? (
                <BoutonConfirmation
                  libelle={t("Supprimer", "Delete")}
                  variante="discret"
                  icone="corbeille"
                  ariaLabel={t(
                    `Supprimer la dépendance de ${d.successeur} envers ${d.predecesseur}`,
                    `Delete the dependency of ${d.successeur} on ${d.predecesseur}`,
                  )}
                  question={t("Supprimer cette dépendance ?", "Delete this dependency?")}
                  libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
                  texteChargement={t("Suppression…", "Deleting…")}
                  action={() =>
                    suppr.envoyer(
                      { ok: true, charge: null },
                      () => api.supprimer(`${base}/${encodeURIComponent(d.id)}`),
                      {
                        succes: t(
                          "Dépendance supprimée : le planning est recalculé.",
                          "Dependency deleted: the schedule is recalculated.",
                        ),
                      },
                    )
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {modifiable && taches.length >= 2 ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire mp-sous-formulaire"
          noValidate
          onSubmit={soumettre}
          aria-label={t("Ajouter une dépendance", "Add a dependency")}
        >
          <p className="mp-sous-formulaire__titre">
            {t("Ajouter une dépendance", "Add a dependency")}
          </p>
          <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
          <div className="mp-grille-champs mp-grille-champs--bas">
            <Select
              libelle={t("Tâche précédente", "Preceding task")}
              options={taches}
              invite={t("Choisir…", "Choose…")}
              value={s.predecesseur_id}
              onChange={(e) => setS((x) => ({ ...x, predecesseur_id: e.target.value }))}
              erreur={f.erreurs.predecesseur_id}
            />
            <Select
              libelle={t("Tâche suivante", "Following task")}
              options={taches}
              invite={t("Choisir…", "Choose…")}
              value={s.successeur_id}
              onChange={(e) => setS((x) => ({ ...x, successeur_id: e.target.value }))}
              erreur={f.erreurs.successeur_id}
              aide={t(
                "Elle commencera après la fin de la tâche précédente.",
                "It will start after the preceding task ends.",
              )}
            />
            <Champ
              libelle={t("Décalage (jours ouvrés)", "Offset (business days)")}
              inputMode="numeric"
              autoComplete="off"
              value={s.decalage}
              onChange={(e) => setS((x) => ({ ...x, decalage: e.target.value }))}
              erreur={f.erreurs.decalage}
              aide={t(
                "0 : enchaînement direct. Négatif : chevauchement.",
                "0: back to back. Negative: overlap.",
              )}
            />
          </div>
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              icone="plus"
              chargement={f.enCours}
              texteChargement={t("Ajout…", "Adding…")}
            >
              {t("Ajouter la dépendance", "Add the dependency")}
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

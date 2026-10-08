"use client";

import { useState, type FormEvent } from "react";
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
  const [s, setS] = useState({ predecesseur_id: "", successeur_id: "", decalage: "0" });
  const f = useFormulaire<Champs>();
  const suppr = useFormulaire<never>();
  const base = `/api/missions/${encodeURIComponent(missionId)}/dependances`;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerDependance(s), (c) => api.post(base, c), {
      succes: "Dépendance ajoutée : le planning est recalculé.",
      apres: () => setS({ predecesseur_id: "", successeur_id: "", decalage: "0" }),
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={suppr.erreurGlobale}
        refAlerte={suppr.refAlerte}
        titreErreur="Suppression impossible"
      />
      {dependances.length === 0 ? (
        <p className="mp-texte-doux">Aucune dépendance : chaque tâche démarre au plus tôt.</p>
      ) : (
        <ul className="mp-liste-lignes">
          {dependances.map((d) => (
            <li key={d.id} className="mp-liste-lignes__ligne">
              <span className="mp-liste-lignes__texte mp-coupure">
                <span>
                  <strong>{d.successeur}</strong> commence après la fin de{" "}
                  <strong>{d.predecesseur}</strong>
                </span>
                {d.decalage !== 0 ? (
                  <span className="mp-texte-doux">
                    {`Décalage : ${d.decalage > 0 ? "+" : "−"}${formaterNombre(Math.abs(d.decalage), 0)} jour(s) ouvré(s)`}
                  </span>
                ) : null}
              </span>
              {modifiable ? (
                <BoutonConfirmation
                  libelle="Supprimer"
                  variante="discret"
                  icone="corbeille"
                  ariaLabel={`Supprimer la dépendance de ${d.successeur} envers ${d.predecesseur}`}
                  question="Supprimer cette dépendance ?"
                  libelleConfirmation="Oui, supprimer"
                  texteChargement="Suppression…"
                  action={() =>
                    suppr.envoyer({ ok: true, charge: null }, () =>
                      api.supprimer(`${base}/${encodeURIComponent(d.id)}`),
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
          aria-label="Ajouter une dépendance"
        >
          <p className="mp-sous-formulaire__titre">Ajouter une dépendance</p>
          <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
          <div className="mp-grille-champs">
            <Select
              libelle="Tâche précédente"
              options={taches}
              invite="Choisir…"
              value={s.predecesseur_id}
              onChange={(e) => setS((x) => ({ ...x, predecesseur_id: e.target.value }))}
              erreur={f.erreurs.predecesseur_id}
            />
            <Select
              libelle="Tâche suivante"
              options={taches}
              invite="Choisir…"
              value={s.successeur_id}
              onChange={(e) => setS((x) => ({ ...x, successeur_id: e.target.value }))}
              erreur={f.erreurs.successeur_id}
              aide="Elle commencera après la fin de la tâche précédente."
            />
            <Champ
              libelle="Décalage (jours ouvrés)"
              inputMode="numeric"
              autoComplete="off"
              value={s.decalage}
              onChange={(e) => setS((x) => ({ ...x, decalage: e.target.value }))}
              erreur={f.erreurs.decalage}
              aide="0 : enchaînement direct. Négatif : chevauchement."
            />
          </div>
          <div className="mp-actions-formulaire">
            <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
              Ajouter la dépendance
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

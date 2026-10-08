"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import {
  cheminCreationPlan,
  DEVISES_PLAN,
  HORIZON_PLAN,
  hrefPlan,
  messagePlan,
  OPTIONS_HORIZON,
  validerCreationPlan,
  type ChampCreationPlan,
  type PlanResume,
} from "../../lib/plan-strategique";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

/**
 * Création d'un plan stratégique (PLA-01) par un responsable de la mission : titre, horizon
 * (3 à 5 ans, 5 par défaut, fixé à la création) et devise du modèle financier. Rien n'est
 * partagé au client à la création.
 */
export function FormulaireCreationPlan({
  missionId,
  deviseMission,
}: {
  missionId: string;
  deviseMission: Devise;
}) {
  const router = useRouter();
  const f = useFormulaire<ChampCreationPlan>();
  const [titre, setTitre] = useState("");
  const [horizon, setHorizon] = useState(String(HORIZON_PLAN.defaut));
  const [devise, setDevise] = useState<string>(deviseMission);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCreationPlan({ titre, horizon, devise }),
      (charge) => api.post<PlanResume>(cheminCreationPlan(missionId), charge),
      {
        succes: "Plan créé : ouverture de sa page…",
        messageSpecifique: (err) => messagePlan(err, "creer"),
        rafraichir: false,
        apres: (plan) => router.push(hrefPlan(missionId, plan.id)),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Création refusée"
      />
      <Champ
        libelle="Titre du plan"
        required
        maxLength={200}
        autoComplete="off"
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        erreur={f.erreurs.titre}
        aide="Exemple : « Plan stratégique 2027-2031 »."
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Horizon"
          required
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          options={OPTIONS_HORIZON}
          erreur={f.erreurs.horizon}
          aide="Nombre d'exercices du modèle financier. Il ne se modifie plus après la création."
        />
        <Select
          libelle="Devise du modèle financier"
          required
          value={devise}
          onChange={(e) => setDevise(e.target.value)}
          options={DEVISES_PLAN}
          erreur={f.erreurs.devise}
          aide="Tous les montants du plan seront saisis et affichés dans cette devise."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Création…">
          Créer le plan
        </Bouton>
      </div>
    </form>
  );
}

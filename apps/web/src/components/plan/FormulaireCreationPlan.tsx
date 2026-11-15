"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import {
  cheminCreationPlan,
  devisesPlan,
  HORIZON_PLAN,
  hrefPlan,
  messagePlan,
  optionsHorizon,
  validerCreationPlan,
  type ChampCreationPlan,
  type PlanResume,
} from "../../lib/plan-strategique";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<ChampCreationPlan>();
  const [titre, setTitre] = useState("");
  const [horizon, setHorizon] = useState(String(HORIZON_PLAN.defaut));
  const [devise, setDevise] = useState<string>(deviseMission);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCreationPlan({ titre, horizon, devise }, langue),
      (charge) => api.post<PlanResume>(cheminCreationPlan(missionId), charge),
      {
        succes: t("Plan créé : ouverture de sa page…", "Plan created: opening its page…"),
        messageSpecifique: (err) => messagePlan(err, "creer", langue),
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
        titreErreur={t("Création refusée", "Creation refused")}
      />
      <Champ
        libelle={t("Titre du plan", "Plan title")}
        required
        maxLength={200}
        autoComplete="off"
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        erreur={f.erreurs.titre}
        aide={t(
          "Exemple : « Plan stratégique 2027-2031 ».",
          "Example: \u201cStrategic plan 2027-2031\u201d.",
        )}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Horizon", "Horizon")}
          required
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          options={optionsHorizon(langue)}
          erreur={f.erreurs.horizon}
          aide={t(
            "Nombre d'exercices du modèle financier. Il ne se modifie plus après la création.",
            "Number of years in the financial model. It cannot be changed after creation.",
          )}
        />
        <Select
          libelle={t("Devise du modèle financier", "Financial model currency")}
          required
          value={devise}
          onChange={(e) => setDevise(e.target.value)}
          options={devisesPlan(langue)}
          erreur={f.erreurs.devise}
          aide={t(
            "Tous les montants du plan seront saisis et affichés dans cette devise.",
            "All plan amounts will be entered and displayed in this currency.",
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Création…", "Creating…")}
        >
          {t("Créer le plan", "Create plan")}
        </Bouton>
      </div>
    </form>
  );
}

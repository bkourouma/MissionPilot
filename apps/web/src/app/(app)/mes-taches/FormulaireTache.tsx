"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { EVENEMENT_TACHES } from "../../../components/shell/PastilleTaches";
import { Bouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../components/ui/Select";
import { ZoneTexte } from "../../../components/ui/ZoneTexte";
import { api, ErreurApi } from "../../../lib/api";
import {
  changementsTache,
  validerTache,
  type ChampTache,
  type SaisieTache,
  type TacheCollaboration,
} from "../../../lib/taches-collaboration";

export interface FormulaireTacheProps {
  initial: SaisieTache;
  /** Personnes assignables (utilisateurs actifs du cabinet). */
  personnes: readonly OptionSelect[];
  /** Éléments liables proposés (valeur « type:identifiant ») ; vide : pas de choix. */
  entites: readonly OptionSelect[];
  /** Élément imposé (création depuis une fiche) : affiché, non modifiable. */
  entiteImposee?: string;
  /** Modification d'une tâche existante (créateur), sinon création. */
  tache?: TacheCollaboration;
  onAnnuler: () => void;
}

/** Message d'une erreur métier : assigné inactif ou sans accès à l'élément lié. */
function messageTache(e: unknown, langue: "fr" | "en" = "fr"): string | null {
  if (
    e instanceof ErreurApi &&
    e.code === "REQUETE_INVALIDE" &&
    e.message !== "Données invalides." &&
    e.message !== "Invalid data."
  )
    return e.message;
  if (e instanceof ErreurApi && e.statut === 404)
    return langue === "en"
      ? "The linked item is no longer accessible: remove it or choose another one."
      : "L'élément lié n'est plus accessible : retirez-le ou choisissez-en un autre.";
  return null;
}

/**
 * Création (tache.assigner) ou modification par son créateur d'une tâche assignée : titre,
 * description, personne assignée parmi les utilisateurs actifs, échéance, élément lié
 * facultatif (fixé à la création).
 */
export function FormulaireTache({
  initial,
  personnes,
  entites,
  entiteImposee,
  tache,
  onAnnuler,
}: FormulaireTacheProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieTache>(initial);
  const f = useFormulaire<ChampTache>();
  const maj = (champ: ChampTache) => (v: string) => setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerTache(s, langue);
    await f.envoyer(
      v,
      async (c) => {
        if (!tache) return api.post<TacheCollaboration>("/api/taches-collaboration", c);
        const modif = changementsTache(tache, c);
        if (Object.keys(modif).length === 0) return tache;
        return api.patch<TacheCollaboration>(
          `/api/taches-collaboration/${encodeURIComponent(tache.id)}`,
          modif,
        );
      },
      {
        messageSpecifique: (e) => messageTache(e, langue),
        rafraichir: Boolean(tache),
        succes: tache ? t("Tâche enregistrée.", "Task saved.") : undefined,
        apres: (nouvelle) => {
          window.dispatchEvent(new Event(EVENEMENT_TACHES));
          if (!tache) router.push(`/mes-taches/${nouvelle.id}?creee=1`);
          else onAnnuler();
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={tache ? t("Modifier la tâche", "Edit the task") : t("Nouvelle tâche", "New task")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Titre", "Title")}
          required
          maxLength={200}
          value={s.titre}
          onChange={(e) => maj("titre")(e.target.value)}
          erreur={f.erreurs.titre}
        />
        <Select
          libelle={t("Assignée à", "Assigned to")}
          required
          options={personnes}
          invite={t("Choisir la personne…", "Choose the person…")}
          value={s.assignee_id}
          onChange={(e) => maj("assignee_id")(e.target.value)}
          erreur={f.erreurs.assignee_id}
          aide={t(
            "Utilisateurs actifs du cabinet. La personne est notifiée.",
            "Active users of the firm. The person is notified.",
          )}
        />
        <Champ
          libelle={t("Échéance (facultative)", "Due date (optional)")}
          type="date"
          min="2000-01-01"
          max="2100-12-31"
          value={s.echeance}
          onChange={(e) => maj("echeance")(e.target.value)}
          erreur={f.erreurs.echeance}
        />
        {tache ? null : entiteImposee ? (
          <div className="mp-champ">
            <p className="mp-champ__libelle">{t("Élément lié", "Linked item")}</p>
            <p>{entiteImposee}</p>
          </div>
        ) : entites.length > 0 ? (
          <Select
            libelle={t("Élément lié (facultatif)", "Linked item (optional)")}
            options={entites}
            invite={t("Aucun", "None")}
            value={s.entite}
            onChange={(e) => maj("entite")(e.target.value)}
            erreur={f.erreurs.entite}
            aide={t(
              "La personne assignée doit avoir accès à cet élément.",
              "The assignee must have access to this item.",
            )}
          />
        ) : null}
      </div>
      <ZoneTexte
        libelle={t("Description (facultative)", "Description (optional)")}
        maxLength={5000}
        rows={4}
        value={s.description}
        onChange={(e) => maj("description")(e.target.value)}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {tache ? t("Enregistrer", "Save") : t("Créer la tâche", "Create task")}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

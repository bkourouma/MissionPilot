"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
function messageTache(e: unknown): string | null {
  if (e instanceof ErreurApi && e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.")
    return e.message;
  if (e instanceof ErreurApi && e.statut === 404)
    return "L'élément lié n'est plus accessible : retirez-le ou choisissez-en un autre.";
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
  const [s, setS] = useState<SaisieTache>(initial);
  const f = useFormulaire<ChampTache>();
  const maj = (champ: ChampTache) => (v: string) => setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerTache(s);
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
        messageSpecifique: messageTache,
        rafraichir: Boolean(tache),
        succes: tache ? "Tâche enregistrée." : undefined,
        apres: (t) => {
          window.dispatchEvent(new Event(EVENEMENT_TACHES));
          if (!tache) router.push(`/mes-taches/${t.id}?creee=1`);
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
      aria-label={tache ? "Modifier la tâche" : "Nouvelle tâche"}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Titre"
          required
          maxLength={200}
          value={s.titre}
          onChange={(e) => maj("titre")(e.target.value)}
          erreur={f.erreurs.titre}
        />
        <Select
          libelle="Assignée à"
          required
          options={personnes}
          invite="Choisir la personne…"
          value={s.assignee_id}
          onChange={(e) => maj("assignee_id")(e.target.value)}
          erreur={f.erreurs.assignee_id}
          aide="Utilisateurs actifs du cabinet. La personne est notifiée."
        />
        <Champ
          libelle="Échéance (facultative)"
          type="date"
          min="2000-01-01"
          max="2100-12-31"
          value={s.echeance}
          onChange={(e) => maj("echeance")(e.target.value)}
          erreur={f.erreurs.echeance}
        />
        {tache ? null : entiteImposee ? (
          <div className="mp-champ">
            <p className="mp-champ__libelle">Élément lié</p>
            <p>{entiteImposee}</p>
          </div>
        ) : entites.length > 0 ? (
          <Select
            libelle="Élément lié (facultatif)"
            options={entites}
            invite="Aucun"
            value={s.entite}
            onChange={(e) => maj("entite")(e.target.value)}
            erreur={f.erreurs.entite}
            aide="La personne assignée doit avoir accès à cet élément."
          />
        ) : null}
      </div>
      <ZoneTexte
        libelle="Description (facultative)"
        maxLength={5000}
        rows={4}
        value={s.description}
        onChange={(e) => maj("description")(e.target.value)}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {tache ? "Enregistrer" : "Créer la tâche"}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

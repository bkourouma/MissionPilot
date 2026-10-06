"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select } from "../../../components/ui/Select";
import { api } from "../../../lib/api";
import {
  OPTIONS_TYPES,
  SAISIE_COLLABORATEUR_VIDE,
  saisieDepuisCollaborateur,
  validerCollaborateur,
  type ChampCollaborateur,
  type Collaborateur,
  type Grade,
  type SaisieCollaborateur,
} from "../../../lib/collaborateurs";

export interface FormulaireCollaborateurProps {
  collaborateur?: Collaborateur;
  /** Grades actifs ; `null` si la liste n'a pas pu être chargée. */
  grades: Grade[] | null;
}

/** Fiche non financière : aucun coût ni taux dans ce formulaire (FIN-02). */
export function FormulaireCollaborateur({ collaborateur, grades }: FormulaireCollaborateurProps) {
  const router = useRouter();
  const [s, setS] = useState<SaisieCollaborateur>(() =>
    collaborateur ? saisieDepuisCollaborateur(collaborateur) : SAISIE_COLLABORATEUR_VIDE,
  );
  const f = useFormulaire<ChampCollaborateur>();
  const maj = (k: ChampCollaborateur) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));
  const optionsGrades = (grades ?? []).map((g) => ({ valeur: g.id, libelle: g.libelle }));
  if (collaborateur?.grade_id && !optionsGrades.some((o) => o.valeur === collaborateur.grade_id)) {
    optionsGrades.unshift({
      valeur: collaborateur.grade_id,
      libelle: collaborateur.grade_libelle ?? "Grade actuel",
    });
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCollaborateur(s),
      (charge) =>
        collaborateur
          ? api.patch<Collaborateur>(
              `/api/collaborateurs/${encodeURIComponent(collaborateur.id)}`,
              charge,
            )
          : api.post<Collaborateur>("/api/collaborateurs", charge),
      { rafraichir: false, apres: (c) => router.push(`/collaborateurs/${c.id}`) },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Nom complet"
          name="nom"
          required
          maxLength={160}
          value={s.nom}
          onChange={maj("nom")}
          erreur={f.erreurs.nom}
          autoComplete="off"
        />
        <Select
          libelle="Grade"
          name="grade_id"
          invite="Sans grade"
          options={optionsGrades}
          value={s.grade_id}
          onChange={maj("grade_id")}
          erreur={f.erreurs.grade_id}
          aide={
            grades === null
              ? "La liste des grades n'a pas pu être chargée : le grade actuel est conservé."
              : undefined
          }
        />
        <Select
          libelle="Type"
          name="type"
          required
          options={OPTIONS_TYPES}
          value={s.type}
          onChange={maj("type")}
          erreur={f.erreurs.type}
        />
        <Champ
          libelle="Capacité (%)"
          name="capacite_pct"
          required
          inputMode="numeric"
          value={s.capacite_pct}
          onChange={maj("capacite_pct")}
          erreur={f.erreurs.capacite_pct}
          aide="Part du temps disponible pour les missions : 100 à temps plein, 50 à mi-temps."
        />
      </div>
      <Champ
        libelle="Compétences"
        name="competences"
        value={s.competences}
        onChange={maj("competences")}
        erreur={f.erreurs.competences}
        aide="Séparées par des virgules, ex. stratégie, finance d'entreprise, SYSCOHADA."
      />
      <Champ
        libelle="Secteurs"
        name="secteurs"
        value={s.secteurs}
        onChange={maj("secteurs")}
        erreur={f.erreurs.secteurs}
        aide="Séparés par des virgules, ex. banque, agro-industrie."
      />
      <Champ
        libelle="Langues"
        name="langues"
        value={s.langues}
        onChange={maj("langues")}
        erreur={f.erreurs.langues}
        aide="Séparées par des virgules, ex. français, anglais, wolof."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {collaborateur ? "Enregistrer les modifications" : "Créer le collaborateur"}
        </Bouton>
        <Link
          href={collaborateur ? `/collaborateurs/${collaborateur.id}` : "/collaborateurs"}
          className={classesBouton("discret")}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}

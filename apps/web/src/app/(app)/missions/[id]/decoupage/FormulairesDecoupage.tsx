"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../components/ui/CaseACocher";
import { Champ } from "../../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import {
  saisieBudgetDepuisTache,
  SAISIE_TACHE_VIDE,
  validerBudgetTache,
  validerLot,
  validerPhase,
  validerTache,
  type ChampTache,
  type SaisieTache,
  type Tache,
} from "../../../../../lib/decoupage";
import { formaterJours } from "../../../../../lib/format";

export interface GradeDecoupage {
  id: string;
  code: string;
  libelle: string;
}

interface CadreProps {
  titre: string;
  onAnnuler: () => void;
  libelleEnvoi: string;
}

/** Libellé seul (phase), ou libellé + livrable (lot). */
export function FormulaireLibelle({
  titre,
  onAnnuler,
  libelleEnvoi,
  initial,
  avecLivrable,
  envoyer,
}: CadreProps & {
  initial: { libelle: string; est_livrable?: boolean };
  avecLivrable: boolean;
  envoyer: (charge: { libelle: string; est_livrable?: boolean }) => Promise<unknown>;
}) {
  const [libelle, setLibelle] = useState(initial.libelle);
  const [livrable, setLivrable] = useState(initial.est_livrable ?? false);
  const f = useFormulaire<"libelle">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      avecLivrable ? validerLot({ libelle, est_livrable: livrable }) : validerPhase(libelle),
      envoyer,
      { apres: onAnnuler },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <Champ
        libelle="Libellé"
        required
        maxLength={200}
        value={libelle}
        onChange={(e) => setLibelle(e.target.value)}
        erreur={f.erreurs.libelle}
      />
      {avecLivrable ? (
        <CaseACocher
          libelle="Livrable"
          aide="Ce lot correspond à un livrable remis au client."
          checked={livrable}
          onChange={(e) => setLivrable(e.target.checked)}
        />
      ) : null}
      <Actions enCours={f.enCours} libelleEnvoi={libelleEnvoi} onAnnuler={onAnnuler} />
    </form>
  );
}

export function FormulaireTache({
  titre,
  onAnnuler,
  libelleEnvoi,
  initial = SAISIE_TACHE_VIDE,
  envoyer,
}: CadreProps & {
  initial?: SaisieTache;
  envoyer: (charge: Record<string, unknown>) => Promise<unknown>;
}) {
  const [s, setS] = useState<SaisieTache>(initial);
  const f = useFormulaire<ChampTache>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerTache(s), envoyer, { apres: onAnnuler });
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <Champ
        libelle="Libellé"
        required
        maxLength={200}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Début souhaité"
          type="date"
          value={s.date_debut}
          onChange={(e) => setS((x) => ({ ...x, date_debut: e.target.value }))}
          erreur={f.erreurs.date_debut}
          aide="Vide : au plus tôt (début de mission ou après les tâches précédentes)."
        />
        <Champ
          libelle="Durée (jours ouvrés)"
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.duree_jours_ouvres}
          onChange={(e) => setS((x) => ({ ...x, duree_jours_ouvres: e.target.value }))}
          erreur={f.erreurs.duree_jours_ouvres}
        />
      </div>
      <CaseACocher
        libelle="Livrable"
        checked={s.est_livrable}
        onChange={(e) => setS((x) => ({ ...x, est_livrable: e.target.checked }))}
      />
      <Actions enCours={f.enCours} libelleEnvoi={libelleEnvoi} onAnnuler={onAnnuler} />
    </form>
  );
}

/** Budget en jours d'une tâche par grade (PLN-02) ; les lignes nominatives sont conservées. */
export function FormulaireBudgetTache({
  tache,
  grades,
  onAnnuler,
  envoyer,
}: {
  tache: Tache;
  grades: GradeDecoupage[];
  onAnnuler: () => void;
  envoyer: (charge: unknown) => Promise<unknown>;
}) {
  const [s, setS] = useState<Record<string, string>>(() => saisieBudgetDepuisTache(tache));
  const f = useFormulaire<string>();
  const nominatives = (tache.budget ?? []).filter((l) => l.collaborateur_id);
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerBudgetTache(s, tache.budget ?? []), envoyer, { apres: onAnnuler });
  }
  const titre = `Budget en jours de la tâche ${tache.libelle}`;
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale ?? f.erreurs._ ?? null} refAlerte={f.refAlerte} />
      {grades.length === 0 ? (
        <p className="mp-texte-doux">Aucun grade actif dans le cabinet.</p>
      ) : (
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">Jours par grade</legend>
          <p className="mp-champ__aide">Au centième de jour (ex. 2,5). Vide : grade absent.</p>
          <div className="mp-grille-champs mp-grille-champs--serree">
            {grades.map((g) => (
              <Champ
                key={g.id}
                libelle={g.libelle}
                inputMode="decimal"
                autoComplete="off"
                value={s[g.id] ?? ""}
                onChange={(e) => setS((x) => ({ ...x, [g.id]: e.target.value }))}
                erreur={f.erreurs[g.id]}
              />
            ))}
          </div>
        </fieldset>
      )}
      {nominatives.length > 0 ? (
        <p className="mp-texte-doux">
          {`Lignes nominatives conservées : ${nominatives
            .map((l) => `${l.collaborateur_nom ?? "collaborateur"} ${formaterJours(l.jours)}`)
            .join(", ")}.`}
        </p>
      ) : null}
      <Actions enCours={f.enCours} libelleEnvoi="Enregistrer le budget" onAnnuler={onAnnuler} />
    </form>
  );
}

/** Rattacher un élément à un autre parent (alternative clavier au glisser-déposer). */
export function FormulaireParent({
  titre,
  options,
  actuel,
  onAnnuler,
  envoyer,
}: {
  titre: string;
  options: readonly OptionSelect[];
  actuel: string;
  onAnnuler: () => void;
  envoyer: (parentId: string) => Promise<unknown>;
}) {
  const [parent, setParent] = useState(actuel);
  const f = useFormulaire<"parent">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      parent && parent !== actuel
        ? { ok: true, charge: parent }
        : { ok: false, erreurs: { parent: "Choisissez un autre emplacement." } },
      envoyer,
      { apres: onAnnuler },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <Select
        libelle="Nouvel emplacement"
        options={options}
        value={parent}
        onChange={(e) => setParent(e.target.value)}
        erreur={f.erreurs.parent}
        aide="L'élément est placé en dernière position de sa nouvelle phase ou de son nouveau lot."
      />
      <Actions enCours={f.enCours} libelleEnvoi="Déplacer" onAnnuler={onAnnuler} />
    </form>
  );
}

function Actions({
  enCours,
  libelleEnvoi,
  onAnnuler,
}: {
  enCours: boolean;
  libelleEnvoi: string;
  onAnnuler: () => void;
}) {
  return (
    <div className="mp-actions-formulaire">
      <Bouton type="submit" chargement={enCours} texteChargement="Enregistrement…">
        {libelleEnvoi}
      </Bouton>
      <Bouton variante="discret" onClick={onAnnuler}>
        Annuler
      </Bouton>
    </div>
  );
}

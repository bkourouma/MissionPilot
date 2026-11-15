"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const [libelle, setLibelle] = useState(initial.libelle);
  const [livrable, setLivrable] = useState(initial.est_livrable ?? false);
  const f = useFormulaire<"libelle">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      avecLivrable
        ? validerLot({ libelle, est_livrable: livrable }, langue)
        : validerPhase(libelle, langue),
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
        libelle={t("Libellé", "Label")}
        required
        maxLength={200}
        value={libelle}
        onChange={(e) => setLibelle(e.target.value)}
        erreur={f.erreurs.libelle}
      />
      {avecLivrable ? (
        <CaseACocher
          libelle={t("Livrable", "Deliverable")}
          aide={t(
            "Ce lot correspond à un livrable remis au client.",
            "This work package corresponds to a deliverable handed to the client.",
          )}
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
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieTache>(initial);
  const f = useFormulaire<ChampTache>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerTache(s, langue), envoyer, { apres: onAnnuler });
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
        libelle={t("Libellé", "Label")}
        required
        maxLength={200}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Champ
          libelle={t("Début souhaité", "Preferred start")}
          type="date"
          value={s.date_debut}
          onChange={(e) => setS((x) => ({ ...x, date_debut: e.target.value }))}
          erreur={f.erreurs.date_debut}
          aide={t(
            "Vide : au plus tôt (début de mission ou après les tâches précédentes).",
            "Empty: as early as possible (engagement start or after preceding tasks).",
          )}
        />
        <Champ
          libelle={t("Durée (jours ouvrés)", "Duration (working days)")}
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.duree_jours_ouvres}
          onChange={(e) => setS((x) => ({ ...x, duree_jours_ouvres: e.target.value }))}
          erreur={f.erreurs.duree_jours_ouvres}
        />
      </div>
      <CaseACocher
        libelle={t("Livrable", "Deliverable")}
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
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<Record<string, string>>(() => saisieBudgetDepuisTache(tache));
  const f = useFormulaire<string>();
  const nominatives = (tache.budget ?? []).filter((l) => l.collaborateur_id);
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerBudgetTache(s, tache.budget ?? [], langue), envoyer, {
      apres: onAnnuler,
    });
  }
  const titre = t(
    `Budget en jours de la tâche ${tache.libelle}`,
    `Budget in days for task ${tache.libelle}`,
  );
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
        <p className="mp-texte-doux">
          {t("Aucun grade actif dans le cabinet.", "No active grade in the firm.")}
        </p>
      ) : (
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">{t("Jours par grade", "Days by grade")}</legend>
          <p className="mp-champ__aide">
            {t(
              "Au centième de jour (ex. 2,5). Vide : grade absent.",
              "To the hundredth of a day (e.g. 2.5). Empty: grade not used.",
            )}
          </p>
          <div className="mp-grille-champs mp-grille-champs--serree mp-grille-champs--bas">
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
          {`${t("Lignes nominatives conservées :", "Named lines kept:")} ${nominatives
            .map(
              (l) =>
                `${l.collaborateur_nom ?? t("collaborateur", "team member")} ${formaterJours(l.jours, langue)}`,
            )
            .join(", ")}.`}
        </p>
      ) : null}
      <Actions
        enCours={f.enCours}
        libelleEnvoi={t("Enregistrer le budget", "Save the budget")}
        onAnnuler={onAnnuler}
      />
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
  const t = useT();
  const [parent, setParent] = useState(actuel);
  const f = useFormulaire<"parent">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      parent && parent !== actuel
        ? { ok: true, charge: parent }
        : {
            ok: false,
            erreurs: { parent: t("Choisissez un autre emplacement.", "Choose another location.") },
          },
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
        libelle={t("Nouvel emplacement", "New location")}
        options={options}
        value={parent}
        onChange={(e) => setParent(e.target.value)}
        erreur={f.erreurs.parent}
        aide={t(
          "L'élément est placé en dernière position de sa nouvelle phase ou de son nouveau lot.",
          "The item is placed last in its new phase or work package.",
        )}
      />
      <Actions enCours={f.enCours} libelleEnvoi={t("Déplacer", "Move")} onAnnuler={onAnnuler} />
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
  const t = useT();
  return (
    <div className="mp-actions-formulaire">
      <Bouton type="submit" chargement={enCours} texteChargement={t("Enregistrement…", "Saving…")}>
        {libelleEnvoi}
      </Bouton>
      <Bouton variante="discret" onClick={onAnnuler}>
        {t("Annuler", "Cancel")}
      </Bouton>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { STATUTS_ACTION_100J } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminActionsPlan,
  cheminVersionsAction,
  messageDd,
  optionsDe,
  STATUT_ACTION_100J_LIBELLES,
  type ActionPlan100j,
  type ReponseEcriture,
} from "../../lib/due-diligence";
import {
  MOTIF_MAX,
  saisieActionVide,
  TEXTE_LONG_MAX,
  TITRE_MAX,
  validerAction,
  validerRetrait,
  type ChampAction,
  type SaisieAction,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_STATUT = optionsDe(STATUTS_ACTION_100J, STATUT_ACTION_100J_LIBELLES);

export interface ChoixAction {
  equipe: { valeur: string; libelle: string }[];
  initiatives: { valeur: string; libelle: string }[];
  indicateurs: { valeur: string; libelle: string }[];
  /** Les listes d'initiatives et d'indicateurs peuvent être incomplètes (parcours borné). */
  partiel: boolean;
}

export interface FormulaireActionProps {
  dossierId: string;
  choix: ChoixAction;
  /** Présente : correction de cette action (nouvelle version, motif exigé). */
  action?: ActionPlan100j;
}

/** Ajoute le lien courant à la liste s'il n'y figure pas (lien résolu par l'API, hors du parcours borné). */
function avecCourant(
  options: { valeur: string; libelle: string }[],
  courant: { id: string | null; libelle?: string | null } | null | undefined,
) {
  if (!courant?.id || options.some((o) => o.valeur === courant.id)) return options;
  return [{ valeur: courant.id, libelle: courant.libelle ?? "Élément lié" }, ...options];
}

/**
 * Action du plan des 100 jours (DD-15) : jours de début et de fin (0 à 100), statut, responsable
 * (membre de l'équipe de la mission), initiative d'un plan et indicateur du même client. Les liens
 * sont choisis par leur libellé ; l'API vérifie qu'ils appartiennent au même client (`MPZ30`).
 */
export function FormulaireAction({ dossierId, choix, action }: FormulaireActionProps) {
  const f = useFormulaire<ChampAction>();
  const correction = action !== undefined;
  const [s, setS] = useState<SaisieAction>(
    action
      ? {
          libelle: action.libelle,
          description: action.description ?? "",
          jour_debut: String(action.jour_debut),
          jour_fin: String(action.jour_fin),
          statut_action: action.statut_action,
          responsable_id: action.responsable?.id ?? "",
          plan_element_id: action.plan_element?.id ?? "",
          kpi_id: action.kpi?.id ?? "",
          motif: "",
        }
      : saisieActionVide(),
  );
  const maj = (p: Partial<SaisieAction>) => setS((x) => ({ ...x, ...p }));
  const equipe = avecCourant(
    choix.equipe,
    action?.responsable ? { id: action.responsable.id, libelle: action.responsable.nom } : null,
  );
  const initiatives = avecCourant(choix.initiatives, action?.plan_element);
  const indicateurs = avecCourant(choix.indicateurs, action?.kpi);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerAction(s, correction),
      (charge) =>
        action
          ? api.post<ReponseEcriture>(cheminVersionsAction(action.id), {
              ...charge,
              version_courante: action.version,
            })
          : api.post<ReponseEcriture>(cheminActionsPlan(dossierId), charge),
      {
        succes: correction ? "Nouvelle version enregistrée." : "Action ajoutée.",
        messageSpecifique: messageDd,
        apres: () => (correction ? maj({ motif: "" }) : setS(saisieActionVide())),
      },
    );
  }

  async function retirer() {
    if (!action) return;
    await f.envoyer(
      validerRetrait(s.motif, true),
      (charge) =>
        api.post<ReponseEcriture>(cheminVersionsAction(action.id), {
          ...charge,
          version_courante: action.version,
        }),
      { succes: "Action retirée du plan.", messageSpecifique: messageDd },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={correction ? `Corriger l'action ${action.libelle}` : "Nouvelle action du plan"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Action refusée"
      />
      <Champ
        libelle="Action"
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Jour de début"
          required
          inputMode="numeric"
          value={s.jour_debut}
          onChange={(e) => maj({ jour_debut: e.target.value })}
          erreur={f.erreurs.jour_debut}
          aide="De 0 à 100 jours après la date d'opération."
        />
        <Champ
          libelle="Jour de fin"
          required
          inputMode="numeric"
          value={s.jour_fin}
          onChange={(e) => maj({ jour_fin: e.target.value })}
          erreur={f.erreurs.jour_fin}
        />
        <Select
          libelle="Statut"
          required
          options={OPTIONS_STATUT}
          value={s.statut_action}
          onChange={(e) => maj({ statut_action: e.target.value })}
          erreur={f.erreurs.statut_action}
        />
      </div>
      <Select
        libelle="Responsable"
        invite="Non désigné"
        options={equipe}
        value={s.responsable_id}
        onChange={(e) => maj({ responsable_id: e.target.value })}
        erreur={f.erreurs.responsable_id}
        aide="Un membre de l'équipe de la mission."
      />
      {choix.partiel ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            Les listes d&apos;initiatives et d&apos;indicateurs peuvent être incomplètes : seuls les
            éléments que vous pouvez consulter, des premières missions du client, sont proposés.
          </p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle="Initiative du plan stratégique"
          invite="Aucune"
          options={initiatives}
          value={s.plan_element_id}
          onChange={(e) => maj({ plan_element_id: e.target.value })}
          erreur={f.erreurs.plan_element_id}
          aide="Une initiative d'un plan du même client."
        />
        <Select
          libelle="Indicateur de suivi"
          invite="Aucun"
          options={indicateurs}
          value={s.kpi_id}
          onChange={(e) => maj({ kpi_id: e.target.value })}
          erreur={f.erreurs.kpi_id}
          aide="Un indicateur du même client."
        />
      </div>
      <ZoneTexte
        libelle="Description"
        rows={2}
        maxLength={TEXTE_LONG_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      {correction ? (
        <ZoneTexte
          libelle="Motif"
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique. Obligatoire pour corriger comme pour retirer l'action."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {correction ? "Enregistrer la correction" : "Ajouter l'action"}
        </Bouton>
        {correction ? (
          <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
            Retirer cette action
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { STATUTS_ACTION_100J } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminActionsPlan,
  cheminVersionsAction,
  libellesDd,
  messageDd,
  optionsDe,
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
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

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
  libelleDefaut: string,
) {
  if (!courant?.id || options.some((o) => o.valeur === courant.id)) return options;
  return [{ valeur: courant.id, libelle: courant.libelle ?? libelleDefaut }, ...options];
}

/**
 * Action du plan des 100 jours (DD-15) : jours de début et de fin (0 à 100), statut, responsable
 * (membre de l'équipe de la mission), initiative d'un plan et indicateur du même client. Les liens
 * sont choisis par leur libellé ; l'API vérifie qu'ils appartiennent au même client (`MPZ30`).
 */
export function FormulaireAction({ dossierId, choix, action }: FormulaireActionProps) {
  const t = useT();
  const langue = useLangue();
  const optionsStatut = optionsDe(STATUTS_ACTION_100J, libellesDd(langue).STATUT_ACTION);
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
  const libelleLie = t("Élément lié", "Linked item");
  const equipe = avecCourant(
    choix.equipe,
    action?.responsable ? { id: action.responsable.id, libelle: action.responsable.nom } : null,
    libelleLie,
  );
  const initiatives = avecCourant(choix.initiatives, action?.plan_element, libelleLie);
  const indicateurs = avecCourant(choix.indicateurs, action?.kpi, libelleLie);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerAction(s, correction, langue),
      (charge) =>
        action
          ? api.post<ReponseEcriture>(cheminVersionsAction(action.id), {
              ...charge,
              version_courante: action.version,
            })
          : api.post<ReponseEcriture>(cheminActionsPlan(dossierId), charge),
      {
        succes: correction
          ? t("Nouvelle version enregistrée.", "New version saved.")
          : t("Action ajoutée.", "Action added."),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => (correction ? maj({ motif: "" }) : setS(saisieActionVide())),
      },
    );
  }

  async function retirer(): Promise<boolean> {
    if (!action) return false;
    return f.envoyer(
      validerRetrait(s.motif, true, langue),
      (charge) =>
        api.post<ReponseEcriture>(cheminVersionsAction(action.id), {
          ...charge,
          version_courante: action.version,
        }),
      {
        succes: t("Action retirée du plan.", "Action removed from the plan."),
        messageSpecifique: (err) => messageDd(err, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={
        correction
          ? t(`Corriger l'action ${action.libelle}`, `Edit the action ${action.libelle}`)
          : t("Nouvelle action du plan", "New plan action")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Action refusée", "Action refused")}
      />
      <Champ
        libelle={t("Action", "Action")}
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Jour de début", "Start day")}
          required
          inputMode="numeric"
          value={s.jour_debut}
          onChange={(e) => maj({ jour_debut: e.target.value })}
          erreur={f.erreurs.jour_debut}
          aide={t(
            "De 0 à 100 jours après la date d'opération.",
            "From 0 to 100 days after the transaction date.",
          )}
        />
        <Champ
          libelle={t("Jour de fin", "End day")}
          required
          inputMode="numeric"
          value={s.jour_fin}
          onChange={(e) => maj({ jour_fin: e.target.value })}
          erreur={f.erreurs.jour_fin}
        />
        <Select
          libelle={t("Statut", "Status")}
          required
          options={optionsStatut}
          value={s.statut_action}
          onChange={(e) => maj({ statut_action: e.target.value })}
          erreur={f.erreurs.statut_action}
        />
      </div>
      <Select
        libelle={t("Responsable", "Owner")}
        invite={t("Non désigné", "Not assigned")}
        options={equipe}
        value={s.responsable_id}
        onChange={(e) => maj({ responsable_id: e.target.value })}
        erreur={f.erreurs.responsable_id}
        aide={t("Un membre de l'équipe de la mission.", "A member of the engagement team.")}
      />
      {choix.partiel ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Les listes d'initiatives et d'indicateurs peuvent être incomplètes : seuls les éléments que vous pouvez consulter, des premières missions du client, sont proposés.",
              "The lists of initiatives and KPIs may be incomplete: only the items you can view, from the client's first engagements, are offered.",
            )}
          </p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle={t("Initiative du plan stratégique", "Strategic plan initiative")}
          invite={t("Aucune", "None")}
          options={initiatives}
          value={s.plan_element_id}
          onChange={(e) => maj({ plan_element_id: e.target.value })}
          erreur={f.erreurs.plan_element_id}
          aide={t(
            "Une initiative d'un plan du même client.",
            "An initiative of a plan of the same client.",
          )}
        />
        <Select
          libelle={t("Indicateur de suivi", "Tracking KPI")}
          invite={t("Aucun", "None")}
          options={indicateurs}
          value={s.kpi_id}
          onChange={(e) => maj({ kpi_id: e.target.value })}
          erreur={f.erreurs.kpi_id}
          aide={t("Un indicateur du même client.", "A KPI of the same client.")}
        />
      </div>
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={TEXTE_LONG_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      {correction ? (
        <ZoneTexte
          libelle={t("Motif", "Reason")}
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide={t(
            "Conservé dans l'historique. Obligatoire pour corriger comme pour retirer l'action.",
            "Kept in the history. Required to edit as well as to remove the action.",
          )}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {correction
            ? t("Enregistrer la correction", "Save the correction")
            : t("Ajouter l'action", "Add the action")}
        </Bouton>
        {correction ? (
          validerRetrait(s.motif, true, langue).ok ? (
            <BoutonConfirmation
              libelle={t("Retirer cette action", "Remove this action")}
              question={t(
                "Retirer cette action du plan ? Le motif est conservé dans l'historique.",
                "Remove this action from the plan? The reason is kept in the history.",
              )}
              libelleConfirmation={t("Oui, retirer", "Yes, remove")}
              texteChargement={t("Retrait…", "Removing…")}
              variante="danger"
              action={retirer}
            />
          ) : (
            <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
              {t("Retirer cette action", "Remove this action")}
            </Bouton>
          )
        ) : null}
      </div>
    </form>
  );
}

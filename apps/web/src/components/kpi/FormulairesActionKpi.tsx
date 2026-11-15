"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { cheminAlertesKpi, type AlerteEnregistree, type PageKpi } from "../../lib/kpi";
import {
  cheminActionsMission,
  cheminCommentairesAction,
  cheminStatutAction,
  DELAI_DATE_EFFET_SANS_MOTIF_JOURS,
  dateEffetExigeCommentaire,
  erreurEncoreValable,
  messagePilotage,
  optionsAlertes,
  validerAction,
  validerStatutAction,
  type ActionKpi,
  type ChampAction,
  type ChampStatutAction,
  type OptionDecision,
  type SaisieAction,
  type SaisieStatutAction,
} from "../../lib/kpi-pilotage";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionKpi } from "./BoutonActionKpi";

export interface OptionLibelle {
  valeur: string;
  libelle: string;
}

export interface FormulaireActionProps {
  missionId: string;
  kpis: readonly OptionLibelle[];
  /** Alertes du KPI présélectionné (identifiant et libellé), facultatif ; les autres se chargent au choix du KPI. */
  alertes?: readonly OptionLibelle[];
  /** Décisions des revues tenues de la mission (et de la revue d'où l'on vient). */
  decisions?: readonly OptionDecision[];
  personnes: readonly OptionLibelle[];
  /** KPI présélectionné (depuis une fiche KPI, une alerte ou une décision de revue). */
  kpiId?: string;
  alerteId?: string;
  decisionId?: string;
  jour: string;
}

/**
 * Nouvelle action corrective (KPI-18) : un KPI, l'alerte qui l'a déclenchée et la décision de revue
 * qui l'a décidée (toutes deux facultatives), un responsable de l'équipe, une échéance. Le moteur
 * mesurera plus tard son efficacité sur le KPI. L'alerte se choisit parmi celles du KPI retenu ; la
 * décision parmi celles des revues tenues (l'API refuse une revue non tenue ou clôturée).
 */
export function FormulaireAction({
  missionId,
  kpis,
  alertes = [],
  decisions = [],
  personnes,
  kpiId = "",
  alerteId = "",
  decisionId = "",
  jour,
}: FormulaireActionProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampAction>();
  const vide: SaisieAction = {
    kpi_id: kpiId,
    alerte_id: alerteId,
    decision_id: decisionId,
    titre: "",
    description: "",
    responsable_id: "",
    echeance: jour,
  };
  const [s, setS] = useState<SaisieAction>(vide);
  // Alertes du KPI choisi : celles du serveur pour le KPI présélectionné, sinon chargées au choix.
  const [chargees, setChargees] = useState<{
    kpiId: string;
    options: readonly OptionLibelle[];
  } | null>(null);
  useEffect(() => {
    if (s.kpi_id === "" || s.kpi_id === kpiId) return;
    let annule = false;
    api
      .get<PageKpi<AlerteEnregistree>>(cheminAlertesKpi(s.kpi_id, { limite: 20 }))
      .then((p) => {
        if (!annule) setChargees({ kpiId: s.kpi_id, options: optionsAlertes(p.elements, langue) });
      })
      .catch(() => {
        if (!annule) setChargees({ kpiId: s.kpi_id, options: [] });
      });
    return () => {
      annule = true;
    };
  }, [s.kpi_id, kpiId, langue]);
  const alertesDuKpi =
    s.kpi_id === ""
      ? []
      : s.kpi_id === kpiId
        ? alertes
        : chargees?.kpiId === s.kpi_id
          ? chargees.options
          : [];
  // Un message d'erreur de saisie disparaît dès que la valeur redevient valide.
  const validation = validerAction(s, langue);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerAction(s, langue),
      (charge) => api.post<ActionKpi>(cheminActionsMission(missionId), charge),
      {
        succes: t("Action enregistrée.", "Action saved."),
        messageSpecifique: (e) => messagePilotage(e, langue),
      },
    );
    if (ok) setS(vide);
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Nouvelle action corrective", "New corrective action")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Could not save")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("KPI concerné", "KPI concerned")}
          required
          invite={t("Choisir un KPI…", "Choose a KPI…")}
          options={kpis}
          value={s.kpi_id}
          onChange={(e) =>
            // Une alerte appartient à un KPI : changer de KPI vide le choix d'alerte.
            setS((x) => ({ ...x, kpi_id: e.target.value, alerte_id: "" }))
          }
          erreur={erreurEncoreValable(f.erreurs, validation, "kpi_id")}
        />
        <Select
          libelle={t("Alerte à l'origine", "Originating alert")}
          invite={
            s.kpi_id === ""
              ? t("Choisissez d'abord un KPI", "Choose a KPI first")
              : alertesDuKpi.length === 0
                ? t("Aucune alerte pour ce KPI", "No alert for this KPI")
                : t("Aucune", "None")
          }
          options={alertesDuKpi}
          disabled={alertesDuKpi.length === 0}
          value={s.alerte_id}
          onChange={(e) => setS((x) => ({ ...x, alerte_id: e.target.value }))}
          aide={t(
            "Facultatif. L'action est reliée à l'alerte pour suivre ce qui a été fait.",
            "Optional. The action is linked to the alert to track what has been done.",
          )}
        />
        <Select
          libelle={t("Décision de revue à l'origine", "Originating review decision")}
          invite={
            decisions.length === 0
              ? t("Aucune décision de revue tenue", "No decision from a held review")
              : t("Aucune", "None")
          }
          options={decisions}
          disabled={decisions.length === 0}
          value={s.decision_id}
          onChange={(e) => {
            const id = e.target.value;
            const kpiDecision = decisions.find((d) => d.valeur === id)?.kpiId ?? null;
            setS((x) => ({
              ...x,
              decision_id: id,
              // Le KPI de la décision est proposé tant qu'aucun KPI n'est choisi.
              ...(kpiDecision && x.kpi_id === "" ? { kpi_id: kpiDecision, alerte_id: "" } : {}),
            }));
          }}
          aide={t(
            "Facultatif. Seule une décision d'une revue tenue et non clôturée accepte une action.",
            "Optional. Only a decision of a held, unclosed review accepts an action.",
          )}
        />
        <Champ
          libelle={t("Titre de l'action", "Action title")}
          required
          maxLength={200}
          value={s.titre}
          onChange={(e) => setS((x) => ({ ...x, titre: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "titre")}
        />
        <Select
          libelle={t("Responsable", "Owner")}
          required
          invite={t("Choisir…", "Choose…")}
          options={personnes}
          value={s.responsable_id}
          onChange={(e) => setS((x) => ({ ...x, responsable_id: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "responsable_id")}
        />
        <Champ
          libelle={t("Échéance", "Due date")}
          type="date"
          required
          value={s.echeance}
          onChange={(e) => setS((x) => ({ ...x, echeance: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "echeance")}
        />
      </div>
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={3}
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS((x) => ({ ...x, description: e.target.value }))}
        erreur={erreurEncoreValable(f.erreurs, validation, "description")}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer l'action", "Save the action")}
        </Bouton>
      </div>
    </form>
  );
}

/**
 * Changement de statut d'une action : « en cours », « terminée » (avec la date d'effet, le jour
 * dès lequel l'effet est mesuré ; aujourd'hui par défaut) ou « abandonnée » (motif obligatoire).
 * Un état terminal ne se rouvre pas : l'historique est conservé.
 */
export function FormulaireStatutAction({
  action,
  jour,
}: {
  action: Pick<ActionKpi, "id" | "statut">;
  jour: string;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampStatutAction>();
  const [s, setS] = useState<SaisieStatutAction>({
    statut: "terminee",
    date_effet: jour,
    motif: "",
    commentaire: "",
  });
  if (action.statut === "terminee" || action.statut === "abandonnee") {
    return (
      <p className="mp-texte-doux">
        {t(
          `Cette action est ${action.statut === "terminee" ? "terminée" : "abandonnée"} : elle ne se rouvre pas. Ajoutez un commentaire si besoin.`,
          `This action is ${action.statut === "terminee" ? "completed" : "abandoned"}: it cannot be reopened. Add a comment if needed.`,
        )}
      </p>
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerStatutAction(s, jour, langue),
      (charge) => api.post<ActionKpi>(cheminStatutAction(action.id), charge),
      {
        succes: t("Statut mis à jour.", "Status updated."),
        messageSpecifique: (e) => messagePilotage(e, langue),
      },
    );
  }

  return (
    <div className="mp-pile">
      {action.statut === "a_faire" ? (
        <BoutonActionKpi
          libelle={t("Démarrer l'action", "Start the action")}
          chemin={cheminStatutAction(action.id)}
          corps={{ statut: "en_cours" }}
          succes={t("Action démarrée.", "Action started.")}
        />
      ) : null}
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={soumettre}
        aria-label={t("Clôturer ou abandonner l'action", "Complete or abandon the action")}
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Changement impossible", "Could not change")}
        />
        <Select
          libelle={t("Nouvelle situation", "New status")}
          options={[
            { valeur: "terminee", libelle: t("Terminée", "Completed") },
            { valeur: "abandonnee", libelle: t("Abandonnée", "Abandoned") },
          ]}
          value={s.statut}
          onChange={(e) =>
            setS((x) => ({ ...x, statut: e.target.value as SaisieStatutAction["statut"] }))
          }
        />
        {s.statut === "terminee" ? (
          <>
            <Champ
              libelle={t("Date d'effet", "Effective date")}
              type="date"
              max={jour}
              value={s.date_effet}
              onChange={(e) => setS((x) => ({ ...x, date_effet: e.target.value }))}
              erreur={f.erreurs.date_effet}
              aide={t(
                `Premier jour où l'action produit son effet : le moteur compare le KPI avant et après cette date. Au-delà de ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} jours dans le passé, une justification est exigée.`,
                `First day on which the action takes effect: the engine compares the KPI before and after this date. Beyond ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} days in the past, a justification is required.`,
              )}
            />
            {dateEffetExigeCommentaire(s.date_effet, jour) ? (
              <ZoneTexte
                libelle={t(
                  "Justification de la date d'effet",
                  "Justification of the effective date",
                )}
                required
                rows={2}
                maxLength={1000}
                value={s.commentaire}
                onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
                erreur={f.erreurs.commentaire}
                aide={t(
                  "Conservée dans l'historique de l'action.",
                  "Kept in the action's history.",
                )}
              />
            ) : null}
          </>
        ) : (
          <ZoneTexte
            libelle={t("Motif de l'abandon", "Reason for abandoning")}
            required
            rows={2}
            maxLength={500}
            value={s.motif}
            onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
            erreur={f.erreurs.motif}
          />
        )}
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            chargement={f.enCours}
            texteChargement={t("Enregistrement…", "Saving…")}
          >
            {t("Enregistrer", "Save")}
          </Bouton>
        </div>
      </form>
    </div>
  );
}

/** Commentaire ajouté à l'historique de l'action (jamais modifiable ensuite). */
export function FormulaireCommentaireAction({ actionId }: { actionId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"commentaire">();
  const [commentaire, setCommentaire] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const texte = commentaire.trim();
    const ok = await f.envoyer(
      texte === ""
        ? {
            ok: false as const,
            erreurs: { commentaire: t("Saisissez un commentaire.", "Enter a comment.") },
          }
        : texte.length > 1000
          ? {
              ok: false as const,
              erreurs: { commentaire: t("1 000 caractères au plus.", "1,000 characters at most.") },
            }
          : { ok: true as const, charge: { commentaire: texte } },
      (charge) => api.post(cheminCommentairesAction(actionId), charge),
      {
        succes: t("Commentaire ajouté.", "Comment added."),
        messageSpecifique: (e) => messagePilotage(e, langue),
      },
    );
    if (ok) setCommentaire("");
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Ajouter un commentaire", "Add a comment")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Commentaire refusé", "Comment refused")}
      />
      <ZoneTexte
        libelle={t("Commentaire", "Comment")}
        rows={2}
        maxLength={1000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Ajout…", "Adding…")}
        >
          {t("Ajouter", "Add")}
        </Bouton>
      </div>
    </form>
  );
}

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
        if (!annule) setChargees({ kpiId: s.kpi_id, options: optionsAlertes(p.elements) });
      })
      .catch(() => {
        if (!annule) setChargees({ kpiId: s.kpi_id, options: [] });
      });
    return () => {
      annule = true;
    };
  }, [s.kpi_id, kpiId]);
  const alertesDuKpi =
    s.kpi_id === ""
      ? []
      : s.kpi_id === kpiId
        ? alertes
        : chargees?.kpiId === s.kpi_id
          ? chargees.options
          : [];
  // Un message d'erreur de saisie disparaît dès que la valeur redevient valide.
  const validation = validerAction(s);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerAction(s),
      (charge) => api.post<ActionKpi>(cheminActionsMission(missionId), charge),
      { succes: "Action enregistrée.", messageSpecifique: messagePilotage },
    );
    if (ok) setS(vide);
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvelle action corrective"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="KPI concerné"
          required
          invite="Choisir un KPI…"
          options={kpis}
          value={s.kpi_id}
          onChange={(e) =>
            // Une alerte appartient à un KPI : changer de KPI vide le choix d'alerte.
            setS((x) => ({ ...x, kpi_id: e.target.value, alerte_id: "" }))
          }
          erreur={erreurEncoreValable(f.erreurs, validation, "kpi_id")}
        />
        <Select
          libelle="Alerte à l'origine"
          invite={
            s.kpi_id === ""
              ? "Choisissez d'abord un KPI"
              : alertesDuKpi.length === 0
                ? "Aucune alerte pour ce KPI"
                : "Aucune"
          }
          options={alertesDuKpi}
          disabled={alertesDuKpi.length === 0}
          value={s.alerte_id}
          onChange={(e) => setS((x) => ({ ...x, alerte_id: e.target.value }))}
          aide="Facultatif. L'action est reliée à l'alerte pour suivre ce qui a été fait."
        />
        <Select
          libelle="Décision de revue à l'origine"
          invite={decisions.length === 0 ? "Aucune décision de revue tenue" : "Aucune"}
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
          aide="Facultatif. Seule une décision d'une revue tenue et non clôturée accepte une action."
        />
        <Champ
          libelle="Titre de l'action"
          required
          maxLength={200}
          value={s.titre}
          onChange={(e) => setS((x) => ({ ...x, titre: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "titre")}
        />
        <Select
          libelle="Responsable"
          required
          invite="Choisir…"
          options={personnes}
          value={s.responsable_id}
          onChange={(e) => setS((x) => ({ ...x, responsable_id: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "responsable_id")}
        />
        <Champ
          libelle="Échéance"
          type="date"
          required
          value={s.echeance}
          onChange={(e) => setS((x) => ({ ...x, echeance: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "echeance")}
        />
      </div>
      <ZoneTexte
        libelle="Description"
        rows={3}
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS((x) => ({ ...x, description: e.target.value }))}
        erreur={erreurEncoreValable(f.erreurs, validation, "description")}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer l&apos;action
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
        Cette action est {action.statut === "terminee" ? "terminée" : "abandonnée"} : elle ne se
        rouvre pas. Ajoutez un commentaire si besoin.
      </p>
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerStatutAction(s, jour),
      (charge) => api.post<ActionKpi>(cheminStatutAction(action.id), charge),
      { succes: "Statut mis à jour.", messageSpecifique: messagePilotage },
    );
  }

  return (
    <div className="mp-pile">
      {action.statut === "a_faire" ? (
        <BoutonActionKpi
          libelle="Démarrer l'action"
          chemin={cheminStatutAction(action.id)}
          corps={{ statut: "en_cours" }}
          succes="Action démarrée."
        />
      ) : null}
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={soumettre}
        aria-label="Clôturer ou abandonner l'action"
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Changement impossible"
        />
        <Select
          libelle="Nouvelle situation"
          options={[
            { valeur: "terminee", libelle: "Terminée" },
            { valeur: "abandonnee", libelle: "Abandonnée" },
          ]}
          value={s.statut}
          onChange={(e) =>
            setS((x) => ({ ...x, statut: e.target.value as SaisieStatutAction["statut"] }))
          }
        />
        {s.statut === "terminee" ? (
          <>
            <Champ
              libelle="Date d'effet"
              type="date"
              max={jour}
              value={s.date_effet}
              onChange={(e) => setS((x) => ({ ...x, date_effet: e.target.value }))}
              erreur={f.erreurs.date_effet}
              aide={`Premier jour où l'action produit son effet : le moteur compare le KPI avant et après cette date. Au-delà de ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} jours dans le passé, une justification est exigée.`}
            />
            {dateEffetExigeCommentaire(s.date_effet, jour) ? (
              <ZoneTexte
                libelle="Justification de la date d'effet"
                required
                rows={2}
                maxLength={1000}
                value={s.commentaire}
                onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
                erreur={f.erreurs.commentaire}
                aide="Conservée dans l'historique de l'action."
              />
            ) : null}
          </>
        ) : (
          <ZoneTexte
            libelle="Motif de l'abandon"
            required
            rows={2}
            maxLength={500}
            value={s.motif}
            onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
            erreur={f.erreurs.motif}
          />
        )}
        <div className="mp-actions-formulaire">
          <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
            Enregistrer
          </Bouton>
        </div>
      </form>
    </div>
  );
}

/** Commentaire ajouté à l'historique de l'action (jamais modifiable ensuite). */
export function FormulaireCommentaireAction({ actionId }: { actionId: string }) {
  const f = useFormulaire<"commentaire">();
  const [commentaire, setCommentaire] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const texte = commentaire.trim();
    const ok = await f.envoyer(
      texte === ""
        ? { ok: false as const, erreurs: { commentaire: "Saisissez un commentaire." } }
        : texte.length > 1000
          ? { ok: false as const, erreurs: { commentaire: "1 000 caractères au plus." } }
          : { ok: true as const, charge: { commentaire: texte } },
      (charge) => api.post(cheminCommentairesAction(actionId), charge),
      { succes: "Commentaire ajouté.", messageSpecifique: messagePilotage },
    );
    if (ok) setCommentaire("");
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Ajouter un commentaire"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Commentaire refusé"
      />
      <ZoneTexte
        libelle="Commentaire"
        rows={2}
        maxLength={1000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter
        </Bouton>
      </div>
    </form>
  );
}

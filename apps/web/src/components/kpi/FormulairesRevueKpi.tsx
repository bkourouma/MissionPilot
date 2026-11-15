"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminActionRevue,
  cheminDecisionsRevue,
  cheminOrdreDuJour,
  cheminRevues,
  cheminStatutDecision,
  COMPTE_RENDU_MAX,
  DUREE_POINT_DEFAUT_MINUTES,
  messagePilotage,
  POINTS_ORDRE_DU_JOUR_MAX,
  validerCompteRendu,
  validerDecision,
  validerOrdreDuJour,
  validerRevue,
  validerStatutDecision,
  type ChampDecision,
  type ChampRevue,
  type DecisionKpi,
  type RevueKpi,
  type SaisieDecision,
  type SaisieRevue,
} from "../../lib/kpi-pilotage";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionKpi } from "./BoutonActionKpi";
import type { OptionLibelle } from "./FormulairesActionKpi";
import { useEffacementSucces } from "./useEffacementSucces";

/**
 * Planification d'une revue de performance (KPI-17) : titre, date de la réunion, date d'arrêté des
 * KPI examinés (la date de la réunion par défaut) et animateur. L'ordre du jour se propose ensuite.
 */
export function FormulaireRevue({
  missionId,
  personnes,
  jour,
}: {
  missionId: string;
  personnes: readonly OptionLibelle[];
  jour: string;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampRevue>();
  const vide: SaisieRevue = { titre: "", date_prevue: jour, date_reference: "", animateur_id: "" };
  const [s, setS] = useState<SaisieRevue>(vide);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerRevue(s, langue),
      (charge) => api.post<RevueKpi>(cheminRevues(missionId), charge),
      {
        succes: t("Revue planifiée.", "Review scheduled."),
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
      aria-label={t("Planifier une revue de performance", "Schedule a performance review")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Planification impossible", "Could not schedule")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Titre de la revue", "Review title")}
          required
          maxLength={200}
          value={s.titre}
          onChange={(e) => setS((x) => ({ ...x, titre: e.target.value }))}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle={t("Date de la revue", "Review date")}
          type="date"
          required
          value={s.date_prevue}
          onChange={(e) => setS((x) => ({ ...x, date_prevue: e.target.value }))}
          erreur={f.erreurs.date_prevue}
        />
        <Champ
          libelle={t("Date d'arrêté des KPI", "KPI cut-off date")}
          type="date"
          value={s.date_reference}
          onChange={(e) => setS((x) => ({ ...x, date_reference: e.target.value }))}
          erreur={f.erreurs.date_reference}
          aide={t(
            "Vide : la date de la revue. Les mesures postérieures sont ignorées dans le dossier.",
            "Empty: the review date. Later measurements are ignored in the file.",
          )}
        />
        <Select
          libelle={t("Animateur", "Facilitator")}
          invite={t("À désigner", "To be assigned")}
          options={personnes}
          value={s.animateur_id}
          onChange={(e) => setS((x) => ({ ...x, animateur_id: e.target.value }))}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Planification…", "Scheduling…")}
        >
          {t("Planifier la revue", "Schedule the review")}
        </Bouton>
      </div>
    </form>
  );
}

/** Décision prise en revue : libellé, KPI concerné, responsable et échéance (facultatifs). */
export function FormulaireDecision({
  revueId,
  kpis,
  personnes,
}: {
  revueId: string;
  kpis: readonly OptionLibelle[];
  personnes: readonly OptionLibelle[];
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampDecision>();
  const vide: SaisieDecision = { libelle: "", kpi_id: "", responsable_id: "", echeance: "" };
  const [s, setS] = useState<SaisieDecision>(vide);
  const signaler = useEffacementSucces(f.effacerSucces);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    signaler();
    const ok = await f.envoyer(
      validerDecision(s, langue),
      (charge) => api.post<DecisionKpi>(cheminDecisionsRevue(revueId), charge),
      {
        succes: t("Décision enregistrée.", "Decision recorded."),
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
      aria-label={t("Enregistrer une décision", "Record a decision")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Could not save")}
      />
      <ZoneTexte
        libelle={t("Décision", "Decision")}
        required
        rows={2}
        maxLength={500}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("KPI concerné", "KPI concerned")}
          invite={t("Aucun", "None")}
          options={kpis}
          value={s.kpi_id}
          onChange={(e) => setS((x) => ({ ...x, kpi_id: e.target.value }))}
        />
        <Select
          libelle={t("Responsable", "Owner")}
          invite={t("À désigner", "To be assigned")}
          options={personnes}
          value={s.responsable_id}
          onChange={(e) => setS((x) => ({ ...x, responsable_id: e.target.value }))}
        />
        <Champ
          libelle={t("Échéance", "Due date")}
          type="date"
          value={s.echeance}
          onChange={(e) => setS((x) => ({ ...x, echeance: e.target.value }))}
          erreur={f.erreurs.echeance}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la décision", "Record the decision")}
        </Bouton>
      </div>
    </form>
  );
}

/**
 * Ordre du jour saisi à la main (revue planifiée) : une ligne par point, « Libellé » ou
 * « Libellé | durée en minutes ». Remplace l'ordre du jour actuel, y compris celui que le moteur
 * a proposé ; l'ordre du jour est figé dès la tenue de la revue.
 */
export function FormulaireOrdreDuJour({ revueId }: { revueId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"points">();
  const [texte, setTexte] = useState("");
  const signaler = useEffacementSucces(f.effacerSucces);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    signaler();
    const ok = await f.envoyer(
      validerOrdreDuJour(texte, langue),
      (charge) => api.put(cheminOrdreDuJour(revueId), charge),
      {
        succes: t("Ordre du jour remplacé.", "Agenda replaced."),
        messageSpecifique: (e) => messagePilotage(e, langue),
      },
    );
    if (ok) setTexte("");
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Saisir l'ordre du jour", "Enter the agenda")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Ordre du jour refusé", "Agenda refused")}
      />
      <ZoneTexte
        libelle={t("Saisir l'ordre du jour à la main", "Enter the agenda manually")}
        rows={5}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={f.erreurs.points}
        aide={t(
          `Un point par ligne, « Libellé » ou « Libellé | durée en minutes » (${DUREE_POINT_DEFAUT_MINUTES} minutes par défaut) ; ${POINTS_ORDRE_DU_JOUR_MAX} points au plus. Remplace l'ordre du jour actuel.`,
          `One item per line, "Label" or "Label | duration in minutes" (${DUREE_POINT_DEFAUT_MINUTES} minutes by default); ${POINTS_ORDRE_DU_JOUR_MAX} items at most. Replaces the current agenda.`,
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Remplacer l'ordre du jour", "Replace the agenda")}
        </Bouton>
      </div>
    </form>
  );
}

/**
 * Tenue d'une revue : le compte rendu se saisit ici (facultatif) et la tenue demande confirmation,
 * car elle fige le dossier, l'ordre du jour ET le compte rendu.
 */
export function FormulaireTenueRevue({ revueId }: { revueId: string }) {
  const t = useT();
  const langue = useLangue();
  const [texte, setTexte] = useState("");
  const saisie = validerCompteRendu(texte, langue);
  return (
    <div className="mp-pile">
      <ZoneTexte
        libelle={t("Compte rendu de la revue", "Review minutes")}
        rows={5}
        maxLength={COMPTE_RENDU_MAX}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={saisie.ok ? undefined : saisie.erreurs.compte_rendu}
        aide={t(
          "Facultatif. Figé avec le dossier dès que la revue est tenue : il ne se réécrit plus ensuite.",
          "Optional. Frozen with the file once the review is held: it can no longer be rewritten.",
        )}
      />
      {saisie.ok ? (
        <BoutonActionKpi
          libelle={t("Tenir la revue", "Hold the review")}
          chemin={cheminActionRevue(revueId, "tenir")}
          corps={saisie.charge}
          succes={t(
            "Revue tenue : le dossier et le compte rendu sont figés.",
            "Review held: the file and the minutes are frozen.",
          )}
          variante="primaire"
          titreErreur={t("Tenue impossible", "Could not hold the review")}
          confirmation={{
            question: t(
              "Tenir cette revue ? Le dossier, l'ordre du jour et le compte rendu seront figés.",
              "Hold this review? The file, the agenda and the minutes will be frozen.",
            ),
            libelleConfirmation: t("Oui, tenir la revue", "Yes, hold the review"),
          }}
        />
      ) : null}
    </div>
  );
}

/** Suivi d'une décision : en cours, exécutée (commentaire), ou abandonnée avec motif (états définitifs). */
export function SuiviDecision({ decision }: { decision: Pick<DecisionKpi, "id" | "statut"> }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif">();
  const fe = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const [fait, setFait] = useState("");
  const signalerAbandon = useEffacementSucces(f.effacerSucces);
  const signalerExecution = useEffacementSucces(fe.effacerSucces);
  if (decision.statut === "executee" || decision.statut === "abandonnee") return null;

  async function abandonner(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    signalerAbandon();
    await f.envoyer(
      validerStatutDecision("abandonnee", motif, langue),
      (charge) => api.post(cheminStatutDecision(decision.id), charge),
      {
        succes: t("Décision abandonnée.", "Decision abandoned."),
        messageSpecifique: (e) => messagePilotage(e, langue),
      },
    );
  }

  async function executer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    signalerExecution();
    await fe.envoyer(
      validerStatutDecision("executee", fait, langue),
      (charge) => api.post(cheminStatutDecision(decision.id), charge),
      {
        succes: t("Décision exécutée.", "Decision executed."),
        messageSpecifique: (e) => messagePilotage(e, langue),
      },
    );
  }

  return (
    <div className="mp-pile">
      {decision.statut === "ouverte" ? (
        <BoutonActionKpi
          libelle={t("Passer en cours", "Mark as in progress")}
          chemin={cheminStatutDecision(decision.id)}
          corps={{ statut: "en_cours" }}
          succes={t("Décision en cours.", "Decision in progress.")}
        />
      ) : null}
      <form
        ref={fe.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={executer}
        aria-label={t("Déclarer la décision exécutée", "Declare the decision executed")}
      >
        <RetourFormulaire
          erreur={fe.erreurGlobale}
          succes={fe.succes}
          refAlerte={fe.refAlerte}
          titreErreur={t("Exécution impossible", "Could not execute")}
        />
        <ZoneTexte
          libelle={t("Ce qui a été fait", "What was done")}
          required
          rows={2}
          maxLength={1000}
          value={fait}
          onChange={(e) => setFait(e.target.value)}
          erreur={fe.erreurs.motif}
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            chargement={fe.enCours}
            texteChargement={t("Enregistrement…", "Saving…")}
          >
            {t("Marquer comme exécutée", "Mark as executed")}
          </Bouton>
        </div>
      </form>
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={abandonner}
        aria-label={t("Abandonner la décision", "Abandon the decision")}
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Abandon impossible", "Could not abandon")}
        />
        <ZoneTexte
          libelle={t("Motif de l'abandon", "Reason for abandoning")}
          rows={2}
          maxLength={500}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="danger"
            chargement={f.enCours}
            texteChargement={t("Abandon…", "Abandoning…")}
          >
            {t("Abandonner la décision", "Abandon the decision")}
          </Bouton>
        </div>
      </form>
    </div>
  );
}

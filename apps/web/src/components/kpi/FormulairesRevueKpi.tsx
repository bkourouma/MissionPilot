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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionKpi } from "./BoutonActionKpi";
import type { OptionLibelle } from "./FormulairesActionKpi";

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
  const f = useFormulaire<ChampRevue>();
  const vide: SaisieRevue = { titre: "", date_prevue: jour, date_reference: "", animateur_id: "" };
  const [s, setS] = useState<SaisieRevue>(vide);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerRevue(s),
      (charge) => api.post<RevueKpi>(cheminRevues(missionId), charge),
      { succes: "Revue planifiée.", messageSpecifique: messagePilotage },
    );
    if (ok) setS(vide);
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Planifier une revue de performance"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Planification impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Titre de la revue"
          required
          maxLength={200}
          value={s.titre}
          onChange={(e) => setS((x) => ({ ...x, titre: e.target.value }))}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle="Date de la revue"
          type="date"
          required
          value={s.date_prevue}
          onChange={(e) => setS((x) => ({ ...x, date_prevue: e.target.value }))}
          erreur={f.erreurs.date_prevue}
        />
        <Champ
          libelle="Date d'arrêté des KPI"
          type="date"
          value={s.date_reference}
          onChange={(e) => setS((x) => ({ ...x, date_reference: e.target.value }))}
          erreur={f.erreurs.date_reference}
          aide="Vide : la date de la revue. Les mesures postérieures sont ignorées dans le dossier."
        />
        <Select
          libelle="Animateur"
          invite="À désigner"
          options={personnes}
          value={s.animateur_id}
          onChange={(e) => setS((x) => ({ ...x, animateur_id: e.target.value }))}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Planification…">
          Planifier la revue
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
  const f = useFormulaire<ChampDecision>();
  const vide: SaisieDecision = { libelle: "", kpi_id: "", responsable_id: "", echeance: "" };
  const [s, setS] = useState<SaisieDecision>(vide);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerDecision(s),
      (charge) => api.post<DecisionKpi>(cheminDecisionsRevue(revueId), charge),
      { succes: "Décision enregistrée.", messageSpecifique: messagePilotage },
    );
    if (ok) setS(vide);
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Enregistrer une décision"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <ZoneTexte
        libelle="Décision"
        required
        rows={2}
        maxLength={500}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Select
          libelle="KPI concerné"
          invite="Aucun"
          options={kpis}
          value={s.kpi_id}
          onChange={(e) => setS((x) => ({ ...x, kpi_id: e.target.value }))}
        />
        <Select
          libelle="Responsable"
          invite="À désigner"
          options={personnes}
          value={s.responsable_id}
          onChange={(e) => setS((x) => ({ ...x, responsable_id: e.target.value }))}
        />
        <Champ
          libelle="Échéance"
          type="date"
          value={s.echeance}
          onChange={(e) => setS((x) => ({ ...x, echeance: e.target.value }))}
          erreur={f.erreurs.echeance}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la décision
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
  const f = useFormulaire<"points">();
  const [texte, setTexte] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerOrdreDuJour(texte),
      (charge) => api.put(cheminOrdreDuJour(revueId), charge),
      { succes: "Ordre du jour remplacé.", messageSpecifique: messagePilotage },
    );
    if (ok) setTexte("");
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Saisir l'ordre du jour"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Ordre du jour refusé"
      />
      <ZoneTexte
        libelle="Saisir l'ordre du jour à la main"
        rows={5}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={f.erreurs.points}
        aide={`Un point par ligne, « Libellé » ou « Libellé | durée en minutes » (${DUREE_POINT_DEFAUT_MINUTES} minutes par défaut) ; ${POINTS_ORDRE_DU_JOUR_MAX} points au plus. Remplace l'ordre du jour actuel.`}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Remplacer l&apos;ordre du jour
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
  const [texte, setTexte] = useState("");
  const saisie = validerCompteRendu(texte);
  return (
    <div className="mp-pile">
      <ZoneTexte
        libelle="Compte rendu de la revue"
        rows={5}
        maxLength={COMPTE_RENDU_MAX}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={saisie.ok ? undefined : saisie.erreurs.compte_rendu}
        aide="Facultatif. Figé avec le dossier dès que la revue est tenue : il ne se réécrit plus ensuite."
      />
      {saisie.ok ? (
        <BoutonActionKpi
          libelle="Tenir la revue"
          chemin={cheminActionRevue(revueId, "tenir")}
          corps={saisie.charge}
          succes="Revue tenue : le dossier et le compte rendu sont figés."
          variante="primaire"
          titreErreur="Tenue impossible"
          confirmation={{
            question:
              "Tenir cette revue ? Le dossier, l'ordre du jour et le compte rendu seront figés.",
            libelleConfirmation: "Oui, tenir la revue",
          }}
        />
      ) : null}
    </div>
  );
}

/** Suivi d'une décision : en cours, exécutée (commentaire), ou abandonnée avec motif (états définitifs). */
export function SuiviDecision({ decision }: { decision: Pick<DecisionKpi, "id" | "statut"> }) {
  const f = useFormulaire<"motif">();
  const fe = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const [fait, setFait] = useState("");
  if (decision.statut === "executee" || decision.statut === "abandonnee") return null;

  async function abandonner(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerStatutDecision("abandonnee", motif),
      (charge) => api.post(cheminStatutDecision(decision.id), charge),
      { succes: "Décision abandonnée.", messageSpecifique: messagePilotage },
    );
  }

  async function executer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await fe.envoyer(
      validerStatutDecision("executee", fait),
      (charge) => api.post(cheminStatutDecision(decision.id), charge),
      { succes: "Décision exécutée.", messageSpecifique: messagePilotage },
    );
  }

  return (
    <div className="mp-pile">
      {decision.statut === "ouverte" ? (
        <BoutonActionKpi
          libelle="Passer en cours"
          chemin={cheminStatutDecision(decision.id)}
          corps={{ statut: "en_cours" }}
          succes="Décision en cours."
        />
      ) : null}
      <form
        ref={fe.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={executer}
        aria-label="Déclarer la décision exécutée"
      >
        <RetourFormulaire
          erreur={fe.erreurGlobale}
          succes={fe.succes}
          refAlerte={fe.refAlerte}
          titreErreur="Exécution impossible"
        />
        <ZoneTexte
          libelle="Ce qui a été fait"
          required
          rows={2}
          maxLength={1000}
          value={fait}
          onChange={(e) => setFait(e.target.value)}
          erreur={fe.erreurs.motif}
        />
        <div className="mp-actions-formulaire">
          <Bouton type="submit" chargement={fe.enCours} texteChargement="Enregistrement…">
            Marquer comme exécutée
          </Bouton>
        </div>
      </form>
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={abandonner}
        aria-label="Abandonner la décision"
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Abandon impossible"
        />
        <ZoneTexte
          libelle="Motif de l'abandon"
          rows={2}
          maxLength={500}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
        <div className="mp-actions-formulaire">
          <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Abandon…">
            Abandonner la décision
          </Bouton>
        </div>
      </form>
    </div>
  );
}

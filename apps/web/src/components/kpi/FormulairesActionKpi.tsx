"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminActionsMission,
  cheminCommentairesAction,
  cheminStatutAction,
  DELAI_DATE_EFFET_SANS_MOTIF_JOURS,
  dateEffetExigeCommentaire,
  messagePilotage,
  validerAction,
  validerStatutAction,
  type ActionKpi,
  type ChampAction,
  type ChampStatutAction,
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
  /** Alertes du KPI proposé (identifiant et libellé), facultatif. */
  alertes?: readonly OptionLibelle[];
  personnes: readonly OptionLibelle[];
  /** KPI présélectionné (depuis une fiche KPI ou une alerte). */
  kpiId?: string;
  alerteId?: string;
  jour: string;
}

/**
 * Nouvelle action corrective (KPI-18) : un KPI, une alerte qui l'a déclenchée (facultative), un
 * responsable de l'équipe, une échéance. Le moteur mesurera plus tard son efficacité sur le KPI.
 */
export function FormulaireAction({
  missionId,
  kpis,
  alertes = [],
  personnes,
  kpiId = "",
  alerteId = "",
  jour,
}: FormulaireActionProps) {
  const f = useFormulaire<ChampAction>();
  const vide: SaisieAction = {
    kpi_id: kpiId,
    alerte_id: alerteId,
    titre: "",
    description: "",
    responsable_id: "",
    echeance: jour,
  };
  const [s, setS] = useState<SaisieAction>(vide);

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
          onChange={(e) => setS((x) => ({ ...x, kpi_id: e.target.value }))}
          erreur={f.erreurs.kpi_id}
        />
        {alertes.length > 0 ? (
          <Select
            libelle="Alerte à l'origine"
            invite="Aucune"
            options={alertes}
            value={s.alerte_id}
            onChange={(e) => setS((x) => ({ ...x, alerte_id: e.target.value }))}
            aide="L'action est reliée à l'alerte pour suivre ce qui a été fait."
          />
        ) : null}
        <Champ
          libelle="Titre de l'action"
          required
          maxLength={200}
          value={s.titre}
          onChange={(e) => setS((x) => ({ ...x, titre: e.target.value }))}
          erreur={f.erreurs.titre}
        />
        <Select
          libelle="Responsable"
          required
          invite="Choisir…"
          options={personnes}
          value={s.responsable_id}
          onChange={(e) => setS((x) => ({ ...x, responsable_id: e.target.value }))}
          erreur={f.erreurs.responsable_id}
        />
        <Champ
          libelle="Échéance"
          type="date"
          required
          value={s.echeance}
          onChange={(e) => setS((x) => ({ ...x, echeance: e.target.value }))}
          erreur={f.erreurs.echeance}
        />
      </div>
      <ZoneTexte
        libelle="Description"
        rows={3}
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS((x) => ({ ...x, description: e.target.value }))}
        erreur={f.erreurs.description}
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

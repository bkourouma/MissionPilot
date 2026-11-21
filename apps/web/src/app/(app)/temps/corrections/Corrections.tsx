"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../components/ui/Select";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import type { MonPlanning } from "../../../../lib/planification";
import { estDateIso } from "../../../../lib/semaine";
import { validerCorrection, type SaisieCorrection } from "../../../../lib/temps-admin";
import {
  nomUnite,
  validerMotif,
  type ActiviteInterne,
  type UniteSaisie,
} from "../../../../lib/temps";

const VIDE: SaisieCorrection = { cible: "", date: "", valeur: "", motif: "" };

/**
 * Demande de correction de ses propres temps validés ou clôturés (TPS-09) : les tâches
 * proposées sont celles affectées la semaine du jour choisi (« Mon planning »).
 */
export function DemandeCorrection({
  collaborateurId,
  unite,
  activites,
  aujourdhui,
}: {
  collaborateurId: string;
  unite: UniteSaisie;
  activites: ActiviteInterne[];
  aujourdhui: string;
}) {
  const t = useT();
  const langue = useLangue();
  const [saisie, setSaisie] = useState<SaisieCorrection>(VIDE);
  const [taches, setTaches] = useState<OptionSelect[]>([]);
  const [chargement, setChargement] = useState(false);
  const f = useFormulaire<keyof SaisieCorrection>();

  useEffect(() => {
    if (!estDateIso(saisie.date)) {
      setTaches([]);
      return;
    }
    const controleur = new AbortController();
    setChargement(true);
    api
      .get<MonPlanning>(`/api/mon-planning?semaine=${saisie.date}`, { signal: controleur.signal })
      .then((p) =>
        setTaches(
          [
            ...new Map(
              p.lignes.filter((l) => l.tache.libelle).map((l) => [l.tache.id, l]),
            ).values(),
          ].map((l) => ({
            valeur: `t:${l.tache.id}`,
            libelle: `${l.tache.libelle} — ${l.mission.intitule ?? (langue === "en" ? "Engagement" : "Mission")}`,
          })),
        ),
      )
      .catch(() => setTaches([]))
      .finally(() => setChargement(false));
    return () => controleur.abort();
  }, [saisie.date, langue]);

  const options: OptionSelect[] = [
    ...taches,
    ...activites.map((a) => ({
      valeur: `a:${a.id}`,
      libelle: `${a.libelle} ${t("(activité interne)", "(internal activity)")}`,
    })),
  ];

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCorrection(saisie, collaborateurId, unite, langue),
      (c) => api.post("/api/temps/corrections", c),
      {
        succes: t(
          "Demande de correction envoyée : un gestionnaire la validera.",
          "Correction request sent: a manager will approve it.",
        ),
        apres: () => setSaisie(VIDE),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Demander une correction", "Request a correction")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Demande impossible", "Request not possible")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Jour à corriger", "Day to correct")}
          type="date"
          required
          max={aujourdhui}
          value={saisie.date}
          onChange={(e) => setSaisie((s) => ({ ...s, date: e.target.value, cible: "" }))}
          erreur={f.erreurs.date}
          aide={t(
            "Un jour passé dont le temps est validé ou clôturé.",
            "A past day whose time is approved or closed.",
          )}
        />
        <Select
          libelle={t("Tâche ou activité", "Task or activity")}
          required
          options={options}
          invite={
            chargement ? t("Chargement des tâches…", "Loading tasks…") : t("Choisir…", "Choose…")
          }
          value={saisie.cible}
          onChange={(e) => setSaisie((s) => ({ ...s, cible: e.target.value }))}
          erreur={f.erreurs.cible}
          aide={t(
            "Les tâches proposées sont celles qui vous étaient affectées cette semaine-là.",
            "The tasks offered are those assigned to you that week.",
          )}
        />
        <Champ
          libelle={t(
            `Nouvelle valeur (${nomUnite(unite)})`,
            `New value (${nomUnite(unite, langue)})`,
          )}
          inputMode="decimal"
          autoComplete="off"
          required
          value={saisie.valeur}
          onChange={(e) => setSaisie((s) => ({ ...s, valeur: e.target.value }))}
          erreur={f.erreurs.valeur}
          aide={t(
            "Valeur totale du jour pour cette ligne ; 0 pour retirer le temps.",
            "Total value for the day on this row; 0 to remove the time.",
          )}
        />
      </div>
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        maxLength={500}
        value={saisie.motif}
        onChange={(e) => setSaisie((s) => ({ ...s, motif: e.target.value }))}
        erreur={f.erreurs.motif}
        aide={t(
          "Expliquez pourquoi ce temps doit changer : le motif est conservé dans l'historique.",
          "Explain why this time must change: the reason is kept in the history.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="envoyer"
          chargement={f.enCours}
          texteChargement={t("Envoi…", "Sending…")}
        >
          {t("Demander la correction", "Request the correction")}
        </Bouton>
      </div>
    </form>
  );
}

/** Décision d'une correction (temps.cloturer) : valider, ou rejeter avec un motif. */
export function DecisionCorrection({ id, libelle }: { id: string; libelle: string }) {
  const t = useT();
  const langue = useLangue();
  const [rejet, setRejet] = useState(false);
  const [aConfirmer, setAConfirmer] = useState(false);
  const [rendreFocus, setRendreFocus] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const refConfirmer = useRef<HTMLButtonElement>(null);
  const refValider = useRef<HTMLButtonElement>(null);
  const base = `/api/temps/corrections/${encodeURIComponent(id)}`;

  useEffect(() => {
    if (aConfirmer) refConfirmer.current?.focus();
    else if (rendreFocus) refValider.current?.focus();
  }, [aConfirmer, rendreFocus]);

  async function rejeter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif, langue), (c) => api.post(`${base}/rejeter`, c), {
      succes: t("Correction rejetée.", "Correction rejected."),
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Décision impossible", "Decision not possible")}
      />
      {rejet ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={rejeter}>
          <ZoneTexte
            libelle={t("Motif du rejet", "Reason for rejection")}
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
          />
          <div className="mp-barre-actions">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement={t("Rejet…", "Rejecting…")}
            >
              {t("Rejeter la correction", "Reject the correction")}
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setRejet(false)}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      ) : aConfirmer ? (
        <div
          className="mp-confirmation-decision"
          role="group"
          aria-label={t(`Confirmer la validation : ${libelle}`, `Confirm the approval: ${libelle}`)}
        >
          <p className="mp-confirmation-decision__question">
            {t(
              "Valider cette correction ? Le réalisé du collaborateur sera mis à jour et la décision restera tracée.",
              "Approve this correction? The employee's actuals will be updated and the decision stays tracked.",
            )}
          </p>
          <div className="mp-barre-actions">
            <Bouton
              ref={refConfirmer}
              icone="succes"
              chargement={f.enCours}
              texteChargement={t("Validation…", "Approving…")}
              onClick={() =>
                f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/valider`), {
                  succes: t(
                    "Correction validée : le réalisé est mis à jour.",
                    "Correction approved: actuals are updated.",
                  ),
                })
              }
            >
              {t("Oui, valider", "Yes, approve")}
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={f.enCours}
              onClick={() => {
                setRendreFocus(true);
                setAConfirmer(false);
              }}
            >
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="mp-barre-actions">
          <Bouton
            ref={refValider}
            icone="succes"
            aria-label={t(
              `Valider la correction : ${libelle}`,
              `Approve the correction: ${libelle}`,
            )}
            onClick={() => {
              setRendreFocus(false);
              setAConfirmer(true);
            }}
          >
            {t("Valider", "Approve")}
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="fermer"
            aria-label={t(
              `Rejeter la correction : ${libelle}`,
              `Reject the correction: ${libelle}`,
            )}
            onClick={() => setRejet(true)}
          >
            {t("Rejeter…", "Reject…")}
          </Bouton>
        </div>
      )}
    </div>
  );
}

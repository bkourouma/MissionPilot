"use client";

import { useEffect, useState, type FormEvent } from "react";
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
  NOM_UNITE,
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
            libelle: `${l.tache.libelle} — ${l.mission.intitule ?? "Mission"}`,
          })),
        ),
      )
      .catch(() => setTaches([]))
      .finally(() => setChargement(false));
    return () => controleur.abort();
  }, [saisie.date]);

  const options: OptionSelect[] = [
    ...taches,
    ...activites.map((a) => ({ valeur: `a:${a.id}`, libelle: `${a.libelle} (activité interne)` })),
  ];

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCorrection(saisie, collaborateurId, unite),
      (c) => api.post("/api/temps/corrections", c),
      {
        succes: "Demande de correction envoyée : un gestionnaire la validera.",
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
      aria-label="Demander une correction"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Demande impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Jour à corriger"
          type="date"
          required
          max={aujourdhui}
          value={saisie.date}
          onChange={(e) => setSaisie((s) => ({ ...s, date: e.target.value, cible: "" }))}
          erreur={f.erreurs.date}
        />
        <Select
          libelle="Tâche ou activité"
          required
          options={options}
          invite={chargement ? "Chargement des tâches…" : "Choisir…"}
          value={saisie.cible}
          onChange={(e) => setSaisie((s) => ({ ...s, cible: e.target.value }))}
          erreur={f.erreurs.cible}
          aide="Les tâches proposées sont celles qui vous étaient affectées cette semaine-là."
        />
        <Champ
          libelle={`Nouvelle valeur (${NOM_UNITE[unite]})`}
          inputMode="decimal"
          autoComplete="off"
          required
          value={saisie.valeur}
          onChange={(e) => setSaisie((s) => ({ ...s, valeur: e.target.value }))}
          erreur={f.erreurs.valeur}
          aide="Valeur totale du jour pour cette ligne ; 0 pour retirer le temps."
        />
      </div>
      <ZoneTexte
        libelle="Motif"
        required
        maxLength={500}
        value={saisie.motif}
        onChange={(e) => setSaisie((s) => ({ ...s, motif: e.target.value }))}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="envoyer" chargement={f.enCours} texteChargement="Envoi…">
          Demander la correction
        </Bouton>
      </div>
    </form>
  );
}

/** Décision d'une correction (temps.cloturer) : valider, ou rejeter avec un motif. */
export function DecisionCorrection({ id, libelle }: { id: string; libelle: string }) {
  const [rejet, setRejet] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const base = `/api/temps/corrections/${encodeURIComponent(id)}`;

  async function rejeter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif), (c) => api.post(`${base}/rejeter`, c), {
      succes: "Correction rejetée.",
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Décision impossible"
      />
      {rejet ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={rejeter}>
          <ZoneTexte
            libelle="Motif du rejet"
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
          />
          <div className="mp-barre-actions">
            <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Rejet…">
              Rejeter
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setRejet(false)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-barre-actions">
          <Bouton
            icone="succes"
            chargement={f.enCours}
            texteChargement="Validation…"
            aria-label={`Valider la correction : ${libelle}`}
            onClick={() =>
              f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/valider`), {
                succes: "Correction validée : le réalisé est mis à jour.",
              })
            }
          >
            Valider
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="fermer"
            aria-label={`Rejeter la correction : ${libelle}`}
            onClick={() => setRejet(true)}
          >
            Rejeter…
          </Bouton>
        </div>
      )}
    </div>
  );
}

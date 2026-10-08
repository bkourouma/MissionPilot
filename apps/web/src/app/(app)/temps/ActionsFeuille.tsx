"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../components/ui/Alerte";
import { Bouton } from "../../../components/ui/Bouton";
import { api } from "../../../lib/api";
import { formaterDate, formaterJours } from "../../../lib/format";
import { chargesResteAFaire, type SaisieReste, type UniteSaisie } from "../../../lib/temps";

/** Crée la feuille de la semaine, pré-remplie depuis les affectations (TPS-01). */
export function PreparationFeuille({
  semaine,
  prerempli,
}: {
  semaine: string;
  prerempli: boolean;
}) {
  const f = useFormulaire<never>();
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Création impossible"
      />
      <div className="mp-actions-formulaire">
        <Bouton
          icone="plus"
          chargement={f.enCours}
          texteChargement="Préparation…"
          onClick={() =>
            f.envoyer({ ok: true, charge: { semaine, pre_remplir: true } }, (c) =>
              api.post("/api/feuilles-temps", c),
            )
          }
        >
          {prerempli ? "Commencer ma feuille pré-remplie" : "Commencer ma feuille"}
        </Bouton>
      </div>
    </div>
  );
}

export interface TacheReste {
  tache_id: string;
  mission_id: string;
  libelle: string;
  mission: string;
  /** Dernière déclaration (jours) et sa semaine, si elle existe. */
  dernier: { jours: number; semaine: string } | null;
}

/**
 * Reste à faire par tâche (TPS-05) : déclaré chaque semaine, en jours ; l'atterrissage
 * (réalisé + reste) est recalculé par l'API. Seules les valeurs modifiées partent.
 */
export function ResteAFaire({
  taches,
  semaine,
  unite,
}: {
  taches: TacheReste[];
  semaine: string;
  unite: UniteSaisie;
}) {
  const initiales = Object.fromEntries(
    taches.map((t) => [t.tache_id, t.dernier ? String(t.dernier.jours).replace(".", ",") : ""]),
  );
  const [textes, setTextes] = useState<Record<string, string>>(initiales);
  const [info, setInfo] = useState<string | null>(null);
  const f = useFormulaire<string>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const saisies: SaisieReste[] = taches.map((t) => ({
      tache_id: t.tache_id,
      mission_id: t.mission_id,
      texte: textes[t.tache_id] ?? "",
      initial: initiales[t.tache_id] ?? "",
    }));
    const r = chargesResteAFaire(saisies, semaine, unite);
    setInfo(r.ok && r.charge.length === 0 ? "Aucune valeur modifiée : rien à déclarer." : null);
    if (r.ok && r.charge.length === 0) return;
    await f.envoyer(
      r,
      async (envois) => {
        for (const e of envois) {
          await api.post(
            `/api/missions/${encodeURIComponent(e.mission_id)}/reste-a-faire`,
            e.corps,
          );
        }
      },
      { succes: "Reste à faire déclaré : l'atterrissage des missions est mis à jour." },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Déclarer le reste à faire"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Déclaration impossible"
      />
      {info ? (
        <Alerte tonalite="info" annonce="status">
          <p>{info}</p>
        </Alerte>
      ) : null}
      <ul className="mp-liste-lignes">
        {taches.map((t) => {
          const id = `reste-${t.tache_id}`;
          const erreur = f.erreurs[t.tache_id];
          return (
            <li key={t.tache_id} className="mp-liste-lignes__ligne mp-reste">
              <label className="mp-liste-lignes__texte" htmlFor={id}>
                <strong className="mp-coupure">{t.libelle}</strong>
                <span className="mp-texte-doux">
                  {t.mission}
                  {t.dernier
                    ? ` · dernière déclaration : ${formaterJours(t.dernier.jours)} (semaine du ${formaterDate(t.dernier.semaine)})`
                    : " · jamais déclaré (estimé : budget moins réalisé)"}
                </span>
              </label>
              <span className="mp-reste__saisie">
                <input
                  id={id}
                  className="mp-champ__controle mp-feuille__saisie"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={7}
                  value={textes[t.tache_id] ?? ""}
                  aria-invalid={erreur ? true : undefined}
                  aria-describedby={erreur ? `${id}-erreur` : undefined}
                  onChange={(e) => setTextes((s) => ({ ...s, [t.tache_id]: e.target.value }))}
                />
                <span aria-hidden="true">j</span>
                {erreur ? (
                  <span id={`${id}-erreur`} className="mp-feuille__erreur">
                    {erreur}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Déclaration…"
        >
          Déclarer le reste à faire
        </Bouton>
      </div>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  const f = useFormulaire<never>();
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Création impossible", "Could not create")}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Préparation…", "Preparing…")}
          onClick={() =>
            f.envoyer({ ok: true, charge: { semaine, pre_remplir: true } }, (c) =>
              api.post("/api/feuilles-temps", c),
            )
          }
        >
          {prerempli
            ? t("Commencer ma feuille pré-remplie", "Start my pre-filled timesheet")
            : t("Commencer ma feuille", "Start my timesheet")}
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
  const t = useT();
  const langue = useLangue();
  const initiales = Object.fromEntries(
    taches.map((x) => [x.tache_id, x.dernier ? String(x.dernier.jours).replace(".", ",") : ""]),
  );
  const [textes, setTextes] = useState<Record<string, string>>(initiales);
  const [info, setInfo] = useState<string | null>(null);
  const f = useFormulaire<string>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const saisies: SaisieReste[] = taches.map((x) => ({
      tache_id: x.tache_id,
      mission_id: x.mission_id,
      texte: textes[x.tache_id] ?? "",
      initial: initiales[x.tache_id] ?? "",
    }));
    const r = chargesResteAFaire(saisies, semaine, unite, langue);
    setInfo(
      r.ok && r.charge.length === 0
        ? t("Aucune valeur modifiée : rien à déclarer.", "No value changed: nothing to declare.")
        : null,
    );
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
      {
        succes: t(
          "Reste à faire déclaré : l'atterrissage des missions est mis à jour.",
          "Remaining work declared: the engagement forecasts are updated.",
        ),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Déclarer le reste à faire", "Declare remaining work")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Déclaration impossible", "Could not declare")}
      />
      {info ? (
        <Alerte tonalite="info" annonce="status">
          <p>{info}</p>
        </Alerte>
      ) : null}
      <ul className="mp-liste-lignes">
        {taches.map((x) => {
          const id = `reste-${x.tache_id}`;
          const erreur = f.erreurs[x.tache_id];
          return (
            <li key={x.tache_id} className="mp-liste-lignes__ligne mp-reste">
              <label className="mp-liste-lignes__texte" htmlFor={id}>
                <strong className="mp-coupure">{x.libelle}</strong>
                <span className="mp-texte-doux">
                  {x.mission}
                  {x.dernier
                    ? t(
                        ` · dernière déclaration : ${formaterJours(x.dernier.jours, langue)} (semaine du ${formaterDate(x.dernier.semaine, "UTC", langue)})`,
                        ` · last declaration: ${formaterJours(x.dernier.jours, langue)} (week of ${formaterDate(x.dernier.semaine, "UTC", langue)})`,
                      )
                    : t(
                        " · jamais déclaré (estimé : budget moins réalisé)",
                        " · never declared (estimated: budget minus actuals)",
                      )}
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
                  value={textes[x.tache_id] ?? ""}
                  aria-invalid={erreur ? true : undefined}
                  aria-describedby={erreur ? `${id}-erreur` : undefined}
                  onChange={(e) => setTextes((s) => ({ ...s, [x.tache_id]: e.target.value }))}
                />
                <span aria-hidden="true">{t("j", "d")}</span>
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
          texteChargement={t("Déclaration…", "Declaring…")}
        >
          {t("Déclarer le reste à faire", "Declare remaining work")}
        </Bouton>
      </div>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  deplacer,
  libelleMethode,
  messageAtelier,
  OPTIONS_NOTE_MATRICE,
  ordreInitial,
  pointsRepartis,
  saisieMatrice,
  saisieVote,
  validerClassement,
  validerMatrice,
  validerVote,
  type AtelierDetail,
  type MesContributions,
  type MethodeAtelier,
  type SaisieMatrice,
  type SaisieVote,
} from "../../lib/plan-ateliers";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import "./plan-ateliers.css";

interface OptionSaisie {
  id: string;
  libelle: string;
  description: string | null;
}

export interface ContributionAtelierProps {
  methodes: readonly MethodeAtelier[];
  options: readonly OptionSaisie[];
  /** Points à répartir par personne (vote). */
  budgetPoints: number;
  plafondParOption: number | null;
  axes: AtelierDetail["axes"];
  /** SA contribution courante, par méthode : jamais celle d'un autre. */
  initiale: MesContributions;
  /**
   * Chemin d'API des contributions (cabinet : …/ateliers/:id/contribution ; portail :
   * /api/portail/ateliers/:id/contribution) ; le dépôt (PUT) ajoute « /<méthode> ». Une chaîne,
   * jamais une fonction : le composant est rendu par une page serveur.
   */
  cheminBase: string;
}

/**
 * Dépôt de SA contribution à un atelier ouvert (vote par points, classement, matrice). Chaque
 * enregistrement remplace la précédente (l'historique reste conservé côté serveur). Ni les
 * contributions des autres ni les résultats ne sont affichés pendant l'atelier.
 */
export function ContributionAtelier({
  methodes,
  options,
  budgetPoints,
  plafondParOption,
  axes,
  initiale,
  cheminBase,
}: ContributionAtelierProps) {
  return (
    <div className="mp-pile">
      {methodes.map((m) => (
        <Carte
          key={m}
          titre={libelleMethode(m)}
          niveauTitre={3}
          actions={
            initiale[m] ? (
              <span className="mp-texte-doux mp-texte-petit">{`Version ${initiale[m]?.version} déposée`}</span>
            ) : null
          }
        >
          {m === "vote" ? (
            <FormulaireVote
              options={options}
              budget={budgetPoints}
              plafond={plafondParOption}
              initiale={initiale.vote}
              chemin={`${cheminBase}/vote`}
            />
          ) : m === "priorisation" ? (
            <FormulaireClassement
              options={options}
              initiale={initiale.priorisation}
              chemin={`${cheminBase}/priorisation`}
            />
          ) : (
            <FormulaireMatrice
              options={options}
              axes={axes}
              initiale={initiale.matrice}
              chemin={`${cheminBase}/matrice`}
            />
          )}
        </Carte>
      ))}
    </div>
  );
}

function FormulaireVote({
  options,
  budget,
  plafond,
  initiale,
  chemin,
}: {
  options: readonly OptionSaisie[];
  budget: number;
  plafond: number | null;
  initiale: MesContributions["vote"];
  chemin: string;
}) {
  const f = useFormulaire<string>();
  const [s, setS] = useState<SaisieVote>(() => saisieVote(options, initiale));
  const [global, setGlobal] = useState<string | null>(null);
  const repartis = pointsRepartis(s);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerVote(s, budget, plafond);
    setGlobal(v.global);
    const validation: Resultat<NonNullable<typeof v.corps>, string> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    await f.envoyer(validation, (corps) => api.put(chemin, corps), {
      succes: "Votre vote est enregistré. Vous pouvez le modifier tant que l'atelier est ouvert.",
      messageSpecifique: messageAtelier,
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Vote par points"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-atelier__reste" role="status">
        {`${repartis} point${repartis > 1 ? "s" : ""} répartis sur ${budget}${
          plafond === null ? "" : ` (${plafond} au plus par option)`
        }.`}
      </p>
      {global ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{global}</p>
        </Alerte>
      ) : null}
      <ul className="mp-atelier__liste">
        {options.map((o) => (
          <li key={o.id} className="mp-atelier__ligne">
            <div className="mp-atelier__texte">
              <strong className="mp-coupure">{o.libelle}</strong>
              {o.description ? (
                <span className="mp-texte-doux mp-texte-petit mp-coupure">{o.description}</span>
              ) : null}
            </div>
            <div className="mp-atelier__saisie">
              <Champ
                libelle={`Points pour « ${o.libelle} »`}
                inputMode="numeric"
                value={s[o.id] ?? ""}
                onChange={(e) => setS((x) => ({ ...x, [o.id]: e.target.value }))}
                erreur={f.erreurs[o.id]}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {initiale ? "Remplacer mon vote" : "Enregistrer mon vote"}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireClassement({
  options,
  initiale,
  chemin,
}: {
  options: readonly OptionSaisie[];
  initiale: MesContributions["priorisation"];
  chemin: string;
}) {
  const f = useFormulaire<string>();
  const [ordre, setOrdre] = useState<string[]>(() => ordreInitial(options, initiale));
  const [annonce, setAnnonce] = useState("");
  const parId = new Map(options.map((o) => [o.id, o]));

  function bouger(i: number, delta: number) {
    const id = ordre[i] as string;
    setOrdre((o) => deplacer(o, i, delta));
    setAnnonce(`« ${parId.get(id)?.libelle ?? ""} » passe au rang ${i + delta + 1}.`);
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerClassement(ordre);
    const validation: Resultat<NonNullable<typeof v.corps>, string> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: { classement: v.global ?? "Classement invalide." } };
    await f.envoyer(validation, (corps) => api.put(chemin, corps), {
      succes:
        "Votre classement est enregistré. Vous pouvez le modifier tant que l'atelier est ouvert.",
      messageSpecifique: messageAtelier,
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Priorisation par classement"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        Classez les options de la plus importante (1) à la moins importante.
      </p>
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>
      <ol className="mp-atelier__liste">
        {ordre.map((id, i) => (
          <li key={id} className="mp-atelier__ligne">
            <span className="mp-atelier__rang" aria-hidden="true">{`${i + 1}.`}</span>
            <div className="mp-atelier__texte">
              <strong className="mp-coupure">{parId.get(id)?.libelle}</strong>
              {parId.get(id)?.description ? (
                <span className="mp-texte-doux mp-texte-petit mp-coupure">
                  {parId.get(id)?.description}
                </span>
              ) : null}
            </div>
            <div className="mp-atelier__saisie">
              <Bouton
                variante="discret"
                disabled={i === 0}
                aria-label={`Monter « ${parId.get(id)?.libelle} » au rang ${i}`}
                onClick={() => bouger(i, -1)}
              >
                Monter
              </Bouton>
              <Bouton
                variante="discret"
                disabled={i === ordre.length - 1}
                aria-label={`Descendre « ${parId.get(id)?.libelle} » au rang ${i + 2}`}
                onClick={() => bouger(i, 1)}
              >
                Descendre
              </Bouton>
            </div>
          </li>
        ))}
      </ol>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {initiale ? "Remplacer mon classement" : "Enregistrer mon classement"}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireMatrice({
  options,
  axes,
  initiale,
  chemin,
}: {
  options: readonly OptionSaisie[];
  axes: AtelierDetail["axes"];
  initiale: MesContributions["matrice"];
  chemin: string;
}) {
  const f = useFormulaire<string>();
  const [s, setS] = useState<SaisieMatrice>(() => saisieMatrice(options, initiale));
  const [global, setGlobal] = useState<string | null>(null);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerMatrice(s);
    setGlobal(v.global);
    const validation: Resultat<NonNullable<typeof v.corps>, string> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    await f.envoyer(validation, (corps) => api.put(chemin, corps), {
      succes:
        "Vos notes sont enregistrées. Vous pouvez les modifier tant que l'atelier est ouvert.",
      messageSpecifique: messageAtelier,
    });
  }
  const aide = (a: { libelle: string; inverse: boolean }) =>
    a.inverse
      ? `${a.libelle} : 1 = faible (favorable), 5 = élevé`
      : `${a.libelle} : 1 = faible, 5 = élevé`;

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Matrice"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        {`Notez chaque option de 1 à 5 sur les deux axes. ${aide(axes.x)}. ${aide(axes.y)}. Laissez vide une option que vous ne souhaitez pas placer.`}
      </p>
      {global ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{global}</p>
        </Alerte>
      ) : null}
      <ul className="mp-atelier__liste">
        {options.map((o) => (
          <li key={o.id} className="mp-atelier__ligne">
            <div className="mp-atelier__texte">
              <strong className="mp-coupure">{o.libelle}</strong>
              {o.description ? (
                <span className="mp-texte-doux mp-texte-petit mp-coupure">{o.description}</span>
              ) : null}
              {f.erreurs[o.id] ? <span className="mp-champ__erreur">{f.erreurs[o.id]}</span> : null}
            </div>
            <div className="mp-atelier__saisie">
              <Select
                libelle={`${axes.x.libelle} de « ${o.libelle} »`}
                invite="—"
                options={OPTIONS_NOTE_MATRICE}
                value={s[o.id]?.x ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, [o.id]: { x: e.target.value, y: x[o.id]?.y ?? "" } }))
                }
              />
              <Select
                libelle={`${axes.y.libelle} de « ${o.libelle} »`}
                invite="—"
                options={OPTIONS_NOTE_MATRICE}
                value={s[o.id]?.y ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, [o.id]: { x: x[o.id]?.x ?? "", y: e.target.value } }))
                }
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {initiale ? "Remplacer mes notes" : "Enregistrer mes notes"}
        </Bouton>
      </div>
    </form>
  );
}

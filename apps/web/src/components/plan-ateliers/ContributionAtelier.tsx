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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-pile">
      {methodes.map((m) => (
        <Carte
          key={m}
          titre={libelleMethode(m, langue)}
          niveauTitre={3}
          actions={
            initiale[m] ? (
              <span className="mp-texte-doux mp-texte-petit">{`${t("Version", "Version")} ${initiale[m]?.version} ${t("déposée", "submitted")}`}</span>
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [s, setS] = useState<SaisieVote>(() => saisieVote(options, initiale));
  const [global, setGlobal] = useState<string | null>(null);
  const repartis = pointsRepartis(s);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerVote(s, budget, plafond, langue);
    setGlobal(v.global);
    const validation: Resultat<NonNullable<typeof v.corps>, string> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    await f.envoyer(validation, (corps) => api.put(chemin, corps), {
      succes: t(
        "Votre vote est enregistré. Vous pouvez le modifier tant que l'atelier est ouvert.",
        "Your vote is saved. You can change it as long as the workshop is open.",
      ),
      messageSpecifique: (e) => messageAtelier(e, langue),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Vote par points", "Point voting")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-atelier__reste" role="status">
        {`${t(
          `${repartis} point${repartis > 1 ? "s" : ""} répartis sur ${budget}`,
          `${repartis} point${repartis > 1 ? "s" : ""} allocated out of ${budget}`,
        )}${
          plafond === null
            ? ""
            : t(` (${plafond} au plus par option)`, ` (${plafond} at most per option)`)
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
                libelle={`${t("Points pour", "Points for")} « ${o.libelle} »`}
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
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {initiale
            ? t("Remplacer mon vote", "Replace my vote")
            : t("Enregistrer mon vote", "Save my vote")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [ordre, setOrdre] = useState<string[]>(() => ordreInitial(options, initiale));
  const [annonce, setAnnonce] = useState("");
  const parId = new Map(options.map((o) => [o.id, o]));

  function bouger(i: number, delta: number) {
    const id = ordre[i] as string;
    setOrdre((o) => deplacer(o, i, delta));
    setAnnonce(
      t(
        `« ${parId.get(id)?.libelle ?? ""} » passe au rang ${i + delta + 1}.`,
        `"${parId.get(id)?.libelle ?? ""}" moves to rank ${i + delta + 1}.`,
      ),
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerClassement(ordre, langue);
    const validation: Resultat<NonNullable<typeof v.corps>, string> = v.corps
      ? { ok: true, charge: v.corps }
      : {
          ok: false,
          erreurs: { classement: v.global ?? t("Classement invalide.", "Invalid ranking.") },
        };
    await f.envoyer(validation, (corps) => api.put(chemin, corps), {
      succes: t(
        "Votre classement est enregistré. Vous pouvez le modifier tant que l'atelier est ouvert.",
        "Your ranking is saved. You can change it as long as the workshop is open.",
      ),
      messageSpecifique: (e) => messageAtelier(e, langue),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Priorisation par classement", "Ranking")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        {t(
          "Classez les options de la plus importante (1) à la moins importante.",
          "Rank the options from most important (1) to least important.",
        )}
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
                aria-label={t(
                  `Monter « ${parId.get(id)?.libelle} » au rang ${i}`,
                  `Move "${parId.get(id)?.libelle}" up to rank ${i}`,
                )}
                onClick={() => bouger(i, -1)}
              >
                {t("Monter", "Move up")}
              </Bouton>
              <Bouton
                variante="discret"
                disabled={i === ordre.length - 1}
                aria-label={t(
                  `Descendre « ${parId.get(id)?.libelle} » au rang ${i + 2}`,
                  `Move "${parId.get(id)?.libelle}" down to rank ${i + 2}`,
                )}
                onClick={() => bouger(i, 1)}
              >
                {t("Descendre", "Move down")}
              </Bouton>
            </div>
          </li>
        ))}
      </ol>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {initiale
            ? t("Remplacer mon classement", "Replace my ranking")
            : t("Enregistrer mon classement", "Save my ranking")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [s, setS] = useState<SaisieMatrice>(() => saisieMatrice(options, initiale));
  const [global, setGlobal] = useState<string | null>(null);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerMatrice(s, langue);
    setGlobal(v.global);
    const validation: Resultat<NonNullable<typeof v.corps>, string> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    await f.envoyer(validation, (corps) => api.put(chemin, corps), {
      succes: t(
        "Vos notes sont enregistrées. Vous pouvez les modifier tant que l'atelier est ouvert.",
        "Your scores are saved. You can change them as long as the workshop is open.",
      ),
      messageSpecifique: (e) => messageAtelier(e, langue),
    });
  }
  const aide = (a: { libelle: string; inverse: boolean }) =>
    a.inverse
      ? t(
          `${a.libelle} : 1 = faible (favorable), 5 = élevé`,
          `${a.libelle}: 1 = low (favorable), 5 = high`,
        )
      : t(`${a.libelle} : 1 = faible, 5 = élevé`, `${a.libelle}: 1 = low, 5 = high`);

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Matrice", "Matrix")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        {t(
          `Notez chaque option de 1 à 5 sur les deux axes. ${aide(axes.x)}. ${aide(axes.y)}. Laissez vide une option que vous ne souhaitez pas placer.`,
          `Score each option from 1 to 5 on both axes. ${aide(axes.x)}. ${aide(axes.y)}. Leave an option empty if you do not want to place it.`,
        )}
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
                libelle={`${axes.x.libelle} ${t("de", "of")} « ${o.libelle} »`}
                invite="—"
                options={OPTIONS_NOTE_MATRICE}
                value={s[o.id]?.x ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, [o.id]: { x: e.target.value, y: x[o.id]?.y ?? "" } }))
                }
              />
              <Select
                libelle={`${axes.y.libelle} ${t("de", "of")} « ${o.libelle} »`}
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
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {initiale
            ? t("Remplacer mes notes", "Replace my scores")
            : t("Enregistrer mes notes", "Save my scores")}
        </Bouton>
      </div>
    </form>
  );
}

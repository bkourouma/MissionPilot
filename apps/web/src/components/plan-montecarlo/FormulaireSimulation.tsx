"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  CIBLES_MONTE_CARLO,
  CIBLE_MONTE_CARLO_LIBELLES,
  LIBELLE_TYPE_LOI,
  TYPES_LOI_MONTE_CARLO,
  cheminSimulations,
  cleErreurLoi,
  hrefSimulation,
  libelleVersionProposee,
  messageMonteCarlo,
  saisieInitiale,
  uniteCible,
  validerSimulation,
  type CibleMonteCarlo,
  type HypotheseIncertaine,
  type SaisieLoi,
  type SaisieSimulation,
  type SimulationMonteCarlo,
  type TypeLoiMonteCarlo,
  type VersionProposee,
} from "../../lib/plan-montecarlo";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

export interface FormulaireSimulationProps {
  missionId: string;
  planId: string;
  versions: readonly VersionProposee[];
  versionInitiale: number | null;
  /** Lois de départ de l'API (valeurs provisoires, modifiables). */
  defauts: readonly HypotheseIncertaine[];
}

type ChampLoi = "min" | "mode" | "max" | "moyenne" | "ecartType";

const OPTIONS_TYPE = TYPES_LOI_MONTE_CARLO.map((t) => ({
  valeur: t,
  libelle: LIBELLE_TYPE_LOI[t],
}));

/**
 * Lancement d'une simulation (PLA-16) : version du modèle, graine facultative (le serveur en
 * tire une et la renvoie), nombre de tirages et lois des hypothèses incertaines. Le contrôle
 * reprend les bornes de l'API ; le résultat vient du moteur et s'affiche après enregistrement.
 */
export function FormulaireSimulation({
  missionId,
  planId,
  versions,
  versionInitiale,
  defauts,
}: FormulaireSimulationProps) {
  const router = useRouter();
  const [s, setS] = useState<SaisieSimulation>(() => saisieInitiale(versionInitiale, defauts));
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refErreur = useRef<HTMLDivElement>(null);

  const modifierLoi = (cible: CibleMonteCarlo, patch: Partial<SaisieLoi>) =>
    setS((x) => ({ ...x, lois: { ...x.lois, [cible]: { ...x.lois[cible], ...patch } } }));

  async function lancer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const v = validerSimulation(s);
    setErreurs(v.erreurs);
    if (!v.corps) {
      // Premier champ en erreur : le focus l'y place (clavier, lecteur d'écran).
      const premier = Object.keys(v.erreurs)[0];
      if (premier) {
        const id = premier === "hypotheses" ? "mc-hypotheses" : `mc-${premier.replace(".", "-")}`;
        document.getElementById(id)?.focus();
      }
      return;
    }
    const corps = v.corps;
    setEnCours(true);
    try {
      const sim = await api.post<SimulationMonteCarlo>(cheminSimulations(planId), corps);
      router.push(hrefSimulation(missionId, planId, { simulation: sim.id }));
      router.refresh();
    } catch (err) {
      setErreur(messageMonteCarlo(err));
      refErreur.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  const champLoi = (cible: CibleMonteCarlo, champ: ChampLoi) => ({
    id: `mc-${cible}-${champ}`,
    value: s.lois[cible][champ],
    onChange: (e: { target: { value: string } }) => modifierLoi(cible, { [champ]: e.target.value }),
    erreur: erreurs[cleErreurLoi(cible, champ)],
    inputMode: "decimal" as const,
  });

  return (
    <form className="mp-mc" onSubmit={lancer} noValidate aria-label="Lancer une simulation">
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Simulation refusée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <Alerte tonalite="info" annonce="aucune">
        <p>
          Les lois proposées sont des valeurs de départ provisoires, autour des hypothèses de la
          version choisie : ajustez-les avec le dirigeant. Les écarts s&apos;ajoutent aux hypothèses
          (en points pour les taux et la croissance, en pourcentage pour les charges fixes, en jours
          pour le délai de paiement).
        </p>
      </Alerte>
      <div className="mp-grille-champs">
        <Select
          id="mc-version"
          libelle="Version du modèle financier"
          invite="Choisir…"
          options={versions.map((v) => ({
            valeur: String(v.version),
            libelle: libelleVersionProposee(v),
          }))}
          value={s.version}
          onChange={(e) => setS((x) => ({ ...x, version: e.target.value }))}
          erreur={erreurs.version}
          required
        />
        <Champ
          id="mc-tirages"
          libelle="Nombre de tirages"
          aide="De 100 à 2 000."
          inputMode="numeric"
          value={s.tirages}
          onChange={(e) => setS((x) => ({ ...x, tirages: e.target.value }))}
          erreur={erreurs.tirages}
          required
        />
        <Champ
          id="mc-graine"
          libelle="Graine (facultative)"
          aide="Vide : le serveur en tire une et la conserve avec la simulation, pour la rejouer."
          inputMode="numeric"
          value={s.graine}
          onChange={(e) => setS((x) => ({ ...x, graine: e.target.value }))}
          erreur={erreurs.graine}
        />
      </div>

      <div className="mp-mc__reperes" id="mc-hypotheses" tabIndex={-1}>
        <h4 className="mp-plan__intertitre">Hypothèses incertaines (au plus 5)</h4>
        {erreurs.hypotheses ? (
          <p className="mp-champ__erreur" role="alert">
            {erreurs.hypotheses}
          </p>
        ) : null}
        {CIBLES_MONTE_CARLO.map((cible) => {
          const l = s.lois[cible];
          const unite = uniteCible(cible);
          return (
            <fieldset key={cible} className="mp-mc__loi">
              <legend>{CIBLE_MONTE_CARLO_LIBELLES[cible]}</legend>
              <CaseACocher
                id={`mc-${cible}-actif`}
                libelle="Rendre cette hypothèse incertaine"
                checked={l.actif}
                onChange={(e) => modifierLoi(cible, { actif: e.target.checked })}
              />
              {l.actif ? (
                <>
                  <Select
                    id={`mc-${cible}-type`}
                    libelle="Loi de probabilité"
                    options={OPTIONS_TYPE}
                    value={l.type}
                    onChange={(e) =>
                      modifierLoi(cible, { type: e.target.value as TypeLoiMonteCarlo })
                    }
                  />
                  <div className="mp-grille-champs">
                    <Champ libelle={`Minimum (${unite})`} {...champLoi(cible, "min")} />
                    {l.type === "triangulaire" ? (
                      <Champ
                        libelle={`Valeur la plus probable (${unite})`}
                        {...champLoi(cible, "mode")}
                      />
                    ) : null}
                    {l.type === "normale" ? (
                      <>
                        <Champ libelle={`Moyenne (${unite})`} {...champLoi(cible, "moyenne")} />
                        <Champ
                          libelle={`Écart-type (${unite})`}
                          {...champLoi(cible, "ecartType")}
                        />
                      </>
                    ) : null}
                    <Champ libelle={`Maximum (${unite})`} {...champLoi(cible, "max")} />
                  </div>
                </>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="mp-barre-actions">
        <Bouton type="submit" chargement={enCours} texteChargement="Simulation en cours…">
          Lancer la simulation
        </Bouton>
        <Bouton
          variante="discret"
          disabled={enCours}
          onClick={() => {
            setS(saisieInitiale(Number(s.version) || versionInitiale, defauts));
            setErreurs({});
          }}
        >
          Revenir aux valeurs de départ
        </Bouton>
      </div>
    </form>
  );
}

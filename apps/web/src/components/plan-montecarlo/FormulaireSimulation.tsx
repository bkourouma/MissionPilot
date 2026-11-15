"use client";

import type { Langue } from "@missionpilot/shared";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  CIBLES_MONTE_CARLO,
  TYPES_LOI_MONTE_CARLO,
  cheminSimulations,
  cleErreurLoi,
  hrefSimulation,
  libelleCible,
  libelleTypeLoi,
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
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";

export interface FormulaireSimulationProps {
  missionId: string;
  planId: string;
  versions: readonly VersionProposee[];
  versionInitiale: number | null;
  /** Lois de départ de l'API (valeurs provisoires, modifiables). */
  defauts: readonly HypotheseIncertaine[];
}

type ChampLoi = "min" | "mode" | "max" | "moyenne" | "ecartType";

const optionsType = (langue: Langue) =>
  TYPES_LOI_MONTE_CARLO.map((type) => ({
    valeur: type,
    libelle: libelleTypeLoi(type, langue),
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [s, setS] = useState<SaisieSimulation>(() => saisieInitiale(versionInitiale, defauts));
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const refErreur = useRef<HTMLDivElement>(null);

  const modifierLoi = (cible: CibleMonteCarlo, patch: Partial<SaisieLoi>) =>
    setS((x) => ({ ...x, lois: { ...x.lois, [cible]: { ...x.lois[cible], ...patch } } }));

  async function lancer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const v = validerSimulation(s, langue);
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
      rafraichir();
    } catch (err) {
      setErreur(messageMonteCarlo(err, langue));
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
    <form
      className="mp-mc"
      onSubmit={lancer}
      noValidate
      aria-label={t("Lancer une simulation", "Run a simulation")}
    >
      {erreur ? (
        <Alerte
          ref={refErreur}
          tonalite="danger"
          titre={t("Simulation refusée", "Simulation rejected")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <Alerte tonalite="info" annonce="aucune">
        <p>
          {t(
            "Les lois proposées sont des valeurs de départ provisoires, autour des hypothèses de la version choisie : ajustez-les avec le dirigeant. Les écarts s'ajoutent aux hypothèses (en points pour les taux et la croissance, en pourcentage pour les charges fixes, en jours pour le délai de paiement).",
            "The proposed distributions are provisional starting values around the assumptions of the selected version: adjust them with the executive. Deviations are added to the assumptions (in points for rates and growth, in percent for fixed costs, in days for the payment term).",
          )}
        </p>
      </Alerte>
      <div className="mp-grille-champs">
        <Select
          id="mc-version"
          libelle={t("Version du modèle financier", "Financial model version")}
          invite={t("Choisir…", "Choose…")}
          options={versions.map((v) => ({
            valeur: String(v.version),
            libelle: libelleVersionProposee(v, langue),
          }))}
          value={s.version}
          onChange={(e) => setS((x) => ({ ...x, version: e.target.value }))}
          erreur={erreurs.version}
          required
        />
        <Champ
          id="mc-tirages"
          libelle={t("Nombre de tirages", "Number of draws")}
          aide={t("De 100 à 2 000.", "From 100 to 2,000.")}
          inputMode="numeric"
          value={s.tirages}
          onChange={(e) => setS((x) => ({ ...x, tirages: e.target.value }))}
          erreur={erreurs.tirages}
          required
        />
        <Champ
          id="mc-graine"
          libelle={t("Graine (facultative)", "Seed (optional)")}
          aide={t(
            "Vide : le serveur en tire une et la conserve avec la simulation, pour la rejouer.",
            "Empty: the server picks one and keeps it with the simulation, so it can be replayed.",
          )}
          inputMode="numeric"
          value={s.graine}
          onChange={(e) => setS((x) => ({ ...x, graine: e.target.value }))}
          erreur={erreurs.graine}
        />
      </div>

      <div className="mp-mc__reperes" id="mc-hypotheses" tabIndex={-1}>
        <h4 className="mp-plan__intertitre">
          {t("Hypothèses incertaines (au plus 5)", "Uncertain assumptions (at most 5)")}
        </h4>
        {erreurs.hypotheses ? (
          <p className="mp-champ__erreur" role="alert">
            {erreurs.hypotheses}
          </p>
        ) : null}
        {CIBLES_MONTE_CARLO.map((cible) => {
          const l = s.lois[cible];
          const unite = uniteCible(cible, langue);
          return (
            <fieldset key={cible} className="mp-mc__loi">
              <legend>{libelleCible(cible, langue)}</legend>
              <CaseACocher
                id={`mc-${cible}-actif`}
                libelle={t("Rendre cette hypothèse incertaine", "Make this assumption uncertain")}
                checked={l.actif}
                onChange={(e) => modifierLoi(cible, { actif: e.target.checked })}
              />
              {l.actif ? (
                <>
                  <Select
                    id={`mc-${cible}-type`}
                    libelle={t("Loi de probabilité", "Probability distribution")}
                    options={optionsType(langue)}
                    value={l.type}
                    onChange={(e) =>
                      modifierLoi(cible, { type: e.target.value as TypeLoiMonteCarlo })
                    }
                  />
                  <div className="mp-grille-champs">
                    <Champ
                      libelle={`${t("Minimum", "Minimum")} (${unite})`}
                      {...champLoi(cible, "min")}
                    />
                    {l.type === "triangulaire" ? (
                      <Champ
                        libelle={`${t("Valeur la plus probable", "Most likely value")} (${unite})`}
                        {...champLoi(cible, "mode")}
                      />
                    ) : null}
                    {l.type === "normale" ? (
                      <>
                        <Champ
                          libelle={`${t("Moyenne", "Mean")} (${unite})`}
                          {...champLoi(cible, "moyenne")}
                        />
                        <Champ
                          libelle={`${t("Écart-type", "Standard deviation")} (${unite})`}
                          {...champLoi(cible, "ecartType")}
                        />
                      </>
                    ) : null}
                    <Champ
                      libelle={`${t("Maximum", "Maximum")} (${unite})`}
                      {...champLoi(cible, "max")}
                    />
                  </div>
                </>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="mp-barre-actions">
        <Bouton
          type="submit"
          chargement={enCours}
          texteChargement={t("Simulation en cours…", "Simulation in progress…")}
        >
          {t("Lancer la simulation", "Run the simulation")}
        </Bouton>
        <Bouton
          variante="discret"
          disabled={enCours}
          onClick={() => {
            setS(saisieInitiale(Number(s.version) || versionInitiale, defauts));
            setErreurs({});
          }}
        >
          {t("Revenir aux valeurs de départ", "Reset to starting values")}
        </Bouton>
      </div>
    </form>
  );
}

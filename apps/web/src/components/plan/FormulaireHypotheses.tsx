"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import {
  CHAMPS_OUVERTURE,
  CLES_OUVERTURE,
  COMMENTAIRE_MAX,
  exercicesSaisis,
  fusionnerResultats,
  nombreErreurs,
  validerCommentaire,
  validerHypotheses,
  type SaisieEcarts,
  type SaisieHypotheses,
} from "../../lib/plan-hypotheses";
import {
  cheminModeles,
  cheminSimulation,
  messageModele,
  resumeAlertes,
  type SimulationModele,
  type VersionModele,
} from "../../lib/plan-modele";
import { hrefModele } from "../../lib/plan-strategique";
import { aideMontant } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";
import { AvertissementPartage } from "./AvertissementPartage";
import { ChampParAnnee } from "./ChampParAnnee";
import { ResultatModele } from "./ResultatModele";
import {
  EditeurApports,
  EditeurEffectifs,
  EditeurEmprunts,
  EditeurInvestissements,
} from "./SaisiesListes";

type Erreurs = Partial<Record<string, string>>;

export interface FormulaireHypothesesProps {
  planId: string;
  missionId: string;
  horizon: number;
  devise: Devise;
  initiale: SaisieHypotheses;
  /** Version dont les hypothèses sont reprises (null : formulaire vierge). */
  versionSource: number | null;
  /** Enregistrer une version est possible (droits, mission ouverte, plafond non atteint). */
  peutEnregistrer: boolean;
  raisonEnregistrement: string | null;
  partage: boolean;
}

interface SectionProps {
  s: SaisieHypotheses;
  maj: (patch: Partial<SaisieHypotheses>) => void;
  erreurs: Erreurs;
  horizon: number;
  devise: Devise;
  exercices: readonly (number | null)[];
}

function SectionActivite({ s, maj, erreurs, devise, exercices }: SectionProps) {
  return (
    <fieldset className="mp-plan-saisie">
      <legend>Activité</legend>
      <div className="mp-grille-champs">
        <Champ
          libelle="Premier exercice prévisionnel"
          required
          inputMode="numeric"
          value={s.premierExercice}
          onChange={(e) => maj({ premierExercice: e.target.value })}
          erreur={erreurs.premierExercice}
          aide="Millésime de l'année 1 (ex. 2027)."
        />
        <Champ
          libelle={`Chiffre d'affaires de référence (${devise})`}
          required
          inputMode="decimal"
          value={s.caReference}
          onChange={(e) => maj({ caReference: e.target.value })}
          erreur={erreurs.caReference}
          aide={`Hors taxes, dernier exercice réel. ${aideMontant(devise)}`}
        />
      </div>
      <ChampParAnnee
        legende="Croissance annuelle du chiffre d'affaires (%)"
        requis
        valeur={s.croissance}
        onChange={(v) => maj({ croissance: v })}
        cle="croissance"
        erreurs={erreurs}
        exercices={exercices}
        aide="En points, dès l'année 1 (ex. 10 pour +10 %, -5 pour un recul)."
      />
      <ChampParAnnee
        legende="Taux de marge brute (%)"
        requis
        valeur={s.marge}
        onChange={(v) => maj({ marge: v })}
        cle="marge"
        erreurs={erreurs}
        exercices={exercices}
        aide="(Chiffre d'affaires − achats consommés) / chiffre d'affaires, de 0 à 100."
      />
      <ChampParAnnee
        legende="Charges externes variables (% du chiffre d'affaires, facultatif)"
        valeur={s.variables}
        onChange={(v) => maj({ variables: v })}
        cle="variables"
        erreurs={erreurs}
        exercices={exercices}
      />
      <ChampParAnnee
        legende={`Charges externes fixes annuelles (${devise}, facultatif)`}
        valeur={s.fixes}
        onChange={(v) => maj({ fixes: v })}
        cle="fixes"
        erreurs={erreurs}
        exercices={exercices}
        aide={`Loyers, services, impôts et taxes. ${aideMontant(devise)}`}
      />
    </fieldset>
  );
}

function SectionBfr({ s, maj, erreurs, exercices }: SectionProps) {
  return (
    <fieldset className="mp-plan-saisie">
      <legend>Besoin en fonds de roulement</legend>
      <p className="mp-texte-doux mp-texte-petit">
        Délais en jours d&apos;une année commerciale de 360 jours, de 0 à 720 (facultatifs).
      </p>
      <ChampParAnnee
        legende="Délai de paiement des clients (jours de chiffre d'affaires)"
        valeur={s.delaiClients}
        onChange={(v) => maj({ delaiClients: v })}
        cle="delaiClients"
        erreurs={erreurs}
        exercices={exercices}
      />
      <ChampParAnnee
        legende="Délai de paiement des fournisseurs (jours d'achats et charges externes)"
        valeur={s.delaiFournisseurs}
        onChange={(v) => maj({ delaiFournisseurs: v })}
        cle="delaiFournisseurs"
        erreurs={erreurs}
        exercices={exercices}
      />
      <ChampParAnnee
        legende="Rotation des stocks (jours d'achats consommés)"
        valeur={s.stocks}
        onChange={(v) => maj({ stocks: v })}
        cle="stocks"
        erreurs={erreurs}
        exercices={exercices}
      />
    </fieldset>
  );
}

function SectionFiscalite({ s, maj, erreurs }: SectionProps) {
  return (
    <fieldset className="mp-plan-saisie">
      <legend>Fiscalité, dividendes et actualisation</legend>
      <div className="mp-grille-champs">
        <Champ
          libelle="Impôt sur les sociétés (%)"
          required
          inputMode="decimal"
          value={s.tauxIS}
          onChange={(e) => maj({ tauxIS: e.target.value })}
          erreur={erreurs.tauxIS}
          aide="25 % : taux de droit commun en Côte d'Ivoire, valeur de départ à faire confirmer par un expert-comptable."
        />
        <Champ
          libelle="Distribution de dividendes (% du résultat, facultatif)"
          inputMode="decimal"
          value={s.tauxDividendes}
          onChange={(e) => maj({ tauxDividendes: e.target.value })}
          erreur={erreurs.tauxDividendes}
          aide="Part du résultat positif de l'année N versée en N+1."
        />
        <Champ
          libelle="Taux d'actualisation (%)"
          required
          inputMode="decimal"
          value={s.tauxActualisation}
          onChange={(e) => maj({ tauxActualisation: e.target.value })}
          erreur={erreurs.tauxActualisation}
          aide="12 % : valeur de départ du moteur pour la VAN, à confirmer par un expert."
        />
      </div>
    </fieldset>
  );
}

function SectionOuverture({ s, maj, erreurs, devise }: SectionProps) {
  return (
    <fieldset className="mp-plan-saisie">
      <legend>Bilan d&apos;ouverture (facultatif)</legend>
      <p className="mp-texte-doux mp-texte-petit">
        Dernier bilan réel (année 0) ; tout est nul par défaut (création d&apos;entreprise). Il doit
        être équilibré : immobilisations + stocks + créances + trésorerie = capital + réserves +
        emprunts en cours (année 0) + dettes fournisseurs. Le moteur refuse un bilan déséquilibré.
      </p>
      <div className="mp-grille-champs">
        {CLES_OUVERTURE.map((k) => {
          const c = CHAMPS_OUVERTURE[k];
          return (
            <Champ
              key={k}
              libelle={c.nature === "duree" ? c.libelle : `${c.libelle} (${devise})`}
              inputMode={c.nature === "duree" ? "numeric" : "decimal"}
              value={s.ouverture[k]}
              onChange={(e) => maj({ ouverture: { ...s.ouverture, [k]: e.target.value } })}
              erreur={erreurs[`ouverture.${k}`]}
              aide={c.nature === "montant_signe" ? "Signe moins admis." : undefined}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

const CHAMPS_ECARTS: { cle: keyof SaisieEcarts; libelle: string }[] = [
  { cle: "croissance", libelle: "Croissance du chiffre d'affaires (points)" },
  { cle: "marge", libelle: "Marge brute (points)" },
  { cle: "variables", libelle: "Charges variables (points)" },
  { cle: "fixes", libelle: "Charges fixes (variation en %)" },
  { cle: "delaiClients", libelle: "Délai clients (jours)" },
];

function SectionScenarios({ s, maj, erreurs }: SectionProps) {
  const groupe = (nom: "optimiste" | "pessimiste", titre: string) => (
    <fieldset className="mp-plan-annuel">
      <legend className="mp-champ__libelle">{titre}</legend>
      <div className="mp-grille-champs mp-grille-champs--serree">
        {CHAMPS_ECARTS.map((c) => (
          <Champ
            key={c.cle}
            libelle={c.libelle}
            inputMode="decimal"
            value={s[nom][c.cle]}
            onChange={(e) => {
              const v = { ...s[nom], [c.cle]: e.target.value };
              maj(nom === "optimiste" ? { optimiste: v } : { pessimiste: v });
            }}
            erreur={erreurs[`${nom}.${c.cle}`]}
          />
        ))}
      </div>
    </fieldset>
  );
  return (
    <fieldset className="mp-plan-saisie">
      <legend>Scénarios optimiste et pessimiste</legend>
      <p className="mp-texte-doux mp-texte-petit">
        Écarts appliqués aux hypothèses de base, chaque année (vide = aucun écart). Valeurs de
        départ du moteur, à ajuster mission par mission.
      </p>
      {groupe("optimiste", "Scénario optimiste")}
      {groupe("pessimiste", "Scénario pessimiste")}
    </fieldset>
  );
}

/**
 * Saisie des hypothèses du modèle financier (PLA-06) : activité, personnel (charges sociales
 * obligatoires), investissements, BFR, financement, fiscalité, bilan d'ouverture et écarts des
 * scénarios. « Simuler » recalcule par le moteur sans rien enregistrer (PLA-09) ; « Enregistrer »
 * crée une version horodatée, non validée. Aucun chiffre n'est calculé dans le navigateur.
 */
export function FormulaireHypotheses({
  planId,
  missionId,
  horizon,
  devise,
  initiale,
  versionSource,
  peutEnregistrer,
  raisonEnregistrement,
  partage,
}: FormulaireHypothesesProps) {
  const router = useRouter();
  const f = useFormulaire<string>();
  const [s, setS] = useState<SaisieHypotheses>(initiale);
  const [commentaire, setCommentaire] = useState("");
  const [action, setAction] = useState<"simuler" | "enregistrer" | null>(null);
  const [simulation, setSimulation] = useState<SimulationModele | null>(null);
  const [annonce, setAnnonce] = useState("");
  const refResultat = useRef<HTMLHeadingElement>(null);
  const maj = (patch: Partial<SaisieHypotheses>) => setS((x) => ({ ...x, ...patch }));
  const exercices = exercicesSaisis(s.premierExercice, horizon);
  const ctx = { horizon, devise };
  const props: SectionProps = { s, maj, erreurs: f.erreurs, horizon, devise, exercices };
  const nbErreurs = nombreErreurs(f.erreurs);

  useEffect(() => {
    if (simulation) refResultat.current?.focus();
  }, [simulation]);

  async function simuler(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    setAction("simuler");
    setAnnonce("");
    // Un résultat précédent ne doit pas rester affiché pour des hypothèses refusées.
    setSimulation(null);
    await f.envoyer(
      validerHypotheses(s, ctx),
      (charge) => api.post<SimulationModele>(cheminSimulation(planId), charge),
      {
        rafraichir: false,
        messageSpecifique: messageModele,
        apres: (r) => {
          setSimulation(r);
          setAnnonce(`Simulation terminée, non enregistrée. ${resumeAlertes(r.resultat)}`);
        },
      },
    );
    setAction(null);
  }

  async function enregistrer() {
    setAction("enregistrer");
    setAnnonce("");
    await f.envoyer(
      fusionnerResultats(validerHypotheses(s, ctx), validerCommentaire(commentaire)),
      (charge) => api.post<VersionModele>(cheminModeles(planId), charge),
      {
        rafraichir: false,
        messageSpecifique: messageModele,
        apres: (v) => {
          setSimulation(null);
          setCommentaire("");
          setAnnonce(
            `Version ${v.version} enregistrée, non validée : un responsable de la mission doit la valider.${partage ? " Le partage au client a été retiré." : ""}`,
          );
          router.push(
            hrefModele(missionId, planId, {
              version: v.version,
              enregistree: true,
              partageRetire: partage,
            }),
          );
        },
      },
    );
    setAction(null);
  }

  return (
    <div className="mp-plan">
      <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={simuler}>
        <p className="mp-texte-doux">
          {versionSource
            ? `Hypothèses reprises de la version ${versionSource} : modifiez-les puis simulez, ou enregistrez une nouvelle version.`
            : "Saisissez les hypothèses, simulez autant de fois que nécessaire, puis enregistrez une version."}{" "}
          Taux en points (25 pour 25 %), montants en {devise}. Horizon : {horizon} ans, fixé à la
          création du plan.
        </p>
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur={action === "enregistrer" ? "Enregistrement refusé" : "Calcul refusé"}
        />
        {nbErreurs > 0 && !f.erreurGlobale ? (
          <Alerte tonalite="danger" titre="Hypothèses à corriger" annonce="alert">
            <p>{`${nbErreurs} champ${nbErreurs > 1 ? "s" : ""} à corriger : chaque erreur est indiquée sous son champ.`}</p>
          </Alerte>
        ) : null}

        <SectionActivite {...props} />
        <fieldset className="mp-plan-saisie">
          <legend>Personnel</legend>
          <EditeurEffectifs
            elements={s.effectifs}
            onChange={(v) => maj({ effectifs: v })}
            erreurs={f.erreurs}
            horizon={horizon}
            devise={devise}
            exercices={exercices}
          />
        </fieldset>
        <fieldset className="mp-plan-saisie">
          <legend>Investissements</legend>
          <EditeurInvestissements
            elements={s.investissements}
            onChange={(v) => maj({ investissements: v })}
            erreurs={f.erreurs}
            horizon={horizon}
            devise={devise}
            exercices={exercices}
          />
        </fieldset>
        <SectionBfr {...props} />
        <fieldset className="mp-plan-saisie">
          <legend>Financement</legend>
          <EditeurEmprunts
            elements={s.emprunts}
            onChange={(v) => maj({ emprunts: v })}
            erreurs={f.erreurs}
            horizon={horizon}
            devise={devise}
            exercices={exercices}
          />
          <EditeurApports
            elements={s.apports}
            onChange={(v) => maj({ apports: v })}
            erreurs={f.erreurs}
            horizon={horizon}
            devise={devise}
            exercices={exercices}
          />
        </fieldset>
        <SectionFiscalite {...props} />
        <SectionOuverture {...props} />
        <SectionScenarios {...props} />

        <fieldset className="mp-plan-saisie">
          <legend>Calcul</legend>
          {peutEnregistrer ? (
            <>
              <AvertissementPartage partage={partage} />
              <ZoneTexte
                libelle="Commentaire de version (facultatif)"
                rows={2}
                maxLength={COMMENTAIRE_MAX}
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                erreur={f.erreurs.commentaire}
                aide="Ex. « Hypothèses validées avec le dirigeant le 12 mars ». Conservé avec la version."
              />
            </>
          ) : raisonEnregistrement ? (
            <Alerte tonalite="info" annonce="aucune">
              <p>{raisonEnregistrement}</p>
            </Alerte>
          ) : null}
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante={peutEnregistrer ? "secondaire" : "primaire"}
              icone="courbe"
              chargement={f.enCours && action === "simuler"}
              texteChargement="Calcul en cours…"
              disabled={f.enCours}
            >
              Simuler sans enregistrer
            </Bouton>
            {peutEnregistrer ? (
              <Bouton
                icone="succes"
                chargement={f.enCours && action === "enregistrer"}
                texteChargement="Enregistrement…"
                disabled={f.enCours}
                onClick={() => void enregistrer()}
              >
                Enregistrer une nouvelle version
              </Bouton>
            ) : null}
          </div>
          <p className="mp-texte-doux mp-texte-petit">
            La simulation est recalculée par le moteur de MissionPilot et n&apos;est pas conservée ;
            une version enregistrée est figée et horodatée, puis doit être validée par un
            responsable de la mission.
          </p>
        </fieldset>
      </form>

      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>

      {simulation ? (
        <section className="mp-plan__section" aria-labelledby="titre-simulation">
          <h4 id="titre-simulation" ref={refResultat} tabIndex={-1} className="mp-section__titre">
            Résultat de la simulation (non enregistrée)
          </h4>
          <Alerte tonalite="info" annonce="aucune">
            <p>
              Simulation non enregistrée : ces chiffres disparaissent si vous quittez la page.
              Enregistrez une version pour les conserver et les faire valider.
            </p>
          </Alerte>
          <ResultatModele
            resultat={simulation.resultat}
            devise={devise}
            idPrefixe="simulation"
            niveauTitre={5}
          />
        </section>
      ) : null}
    </div>
  );
}

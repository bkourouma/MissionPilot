"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { libelleDevise, type Devise } from "../../lib/format";
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  return (
    <fieldset className="mp-plan-saisie">
      <legend>{t("Activité", "Activity")}</legend>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Premier exercice prévisionnel", "First forecast year")}
          required
          inputMode="numeric"
          value={s.premierExercice}
          onChange={(e) => maj({ premierExercice: e.target.value })}
          erreur={erreurs.premierExercice}
          aide={t("Millésime de l'année 1 (ex. 2027).", "Calendar year of year 1 (e.g. 2027).")}
        />
        <Champ
          libelle={t(
            `Chiffre d'affaires de référence (${libelleDevise(devise)})`,
            `Reference revenue (${libelleDevise(devise)})`,
          )}
          required
          inputMode="decimal"
          value={s.caReference}
          onChange={(e) => maj({ caReference: e.target.value })}
          erreur={erreurs.caReference}
          aide={`${t("Hors taxes, dernier exercice réel.", "Excluding tax, last actual year.")} ${aideMontant(devise, langue)}`}
        />
      </div>
      <ChampParAnnee
        legende={t("Croissance annuelle du chiffre d'affaires (%)", "Annual revenue growth (%)")}
        requis
        valeur={s.croissance}
        onChange={(v) => maj({ croissance: v })}
        cle="croissance"
        erreurs={erreurs}
        exercices={exercices}
        aide={t(
          "En points, dès l'année 1 (ex. 10 pour +10 %, -5 pour un recul).",
          "In points, from year 1 (e.g. 10 for +10%, -5 for a decline).",
        )}
      />
      <ChampParAnnee
        legende={t("Taux de marge brute (%)", "Gross margin rate (%)")}
        requis
        valeur={s.marge}
        onChange={(v) => maj({ marge: v })}
        cle="marge"
        erreurs={erreurs}
        exercices={exercices}
        aide={t(
          "(Chiffre d'affaires − achats consommés) / chiffre d'affaires, de 0 à 100.",
          "(Revenue − purchases consumed) / revenue, from 0 to 100.",
        )}
      />
      <ChampParAnnee
        legende={t(
          "Charges externes variables (% du chiffre d'affaires, facultatif)",
          "Variable external expenses (% of revenue, optional)",
        )}
        valeur={s.variables}
        onChange={(v) => maj({ variables: v })}
        cle="variables"
        erreurs={erreurs}
        exercices={exercices}
      />
      <ChampParAnnee
        legende={t(
          `Charges externes fixes annuelles (${libelleDevise(devise)}, facultatif)`,
          `Annual fixed external expenses (${libelleDevise(devise)}, optional)`,
        )}
        valeur={s.fixes}
        onChange={(v) => maj({ fixes: v })}
        cle="fixes"
        erreurs={erreurs}
        exercices={exercices}
        aide={`${t("Loyers, services, impôts et taxes.", "Rent, services, taxes and duties.")} ${aideMontant(devise, langue)}`}
      />
    </fieldset>
  );
}

function SectionBfr({ s, maj, erreurs, exercices }: SectionProps) {
  const t = useT();
  return (
    <fieldset className="mp-plan-saisie">
      <legend>{t("Besoin en fonds de roulement", "Working capital requirement")}</legend>
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Délais en jours d'une année commerciale de 360 jours, de 0 à 720 (facultatifs).",
          "Terms in days of a 360-day commercial year, from 0 to 720 (optional).",
        )}
      </p>
      <ChampParAnnee
        legende={t(
          "Délai de paiement des clients (jours de chiffre d'affaires)",
          "Customer payment terms (days of revenue)",
        )}
        valeur={s.delaiClients}
        onChange={(v) => maj({ delaiClients: v })}
        cle="delaiClients"
        erreurs={erreurs}
        exercices={exercices}
      />
      <ChampParAnnee
        legende={t(
          "Délai de paiement des fournisseurs (jours d'achats et charges externes)",
          "Supplier payment terms (days of purchases and external expenses)",
        )}
        valeur={s.delaiFournisseurs}
        onChange={(v) => maj({ delaiFournisseurs: v })}
        cle="delaiFournisseurs"
        erreurs={erreurs}
        exercices={exercices}
      />
      <ChampParAnnee
        legende={t(
          "Rotation des stocks (jours d'achats consommés)",
          "Inventory turnover (days of purchases consumed)",
        )}
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
  const t = useT();
  return (
    <fieldset className="mp-plan-saisie">
      <legend>
        {t("Fiscalité, dividendes et actualisation", "Tax, dividends and discounting")}
      </legend>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Impôt sur les sociétés (%)", "Corporate income tax (%)")}
          required
          inputMode="decimal"
          value={s.tauxIS}
          onChange={(e) => maj({ tauxIS: e.target.value })}
          erreur={erreurs.tauxIS}
          aide={t(
            "25 % : taux de droit commun en Côte d'Ivoire, valeur de départ à faire confirmer par un expert-comptable.",
            "25%: standard rate in Côte d'Ivoire, a starting value to be confirmed by a chartered accountant.",
          )}
        />
        <Champ
          libelle={t(
            "Distribution de dividendes (% du résultat, facultatif)",
            "Dividend payout (% of income, optional)",
          )}
          inputMode="decimal"
          value={s.tauxDividendes}
          onChange={(e) => maj({ tauxDividendes: e.target.value })}
          erreur={erreurs.tauxDividendes}
          aide={t(
            "Part du résultat positif de l'année N versée en N+1.",
            "Share of year N positive income paid out in year N+1.",
          )}
        />
        <Champ
          libelle={t("Taux d'actualisation (%)", "Discount rate (%)")}
          required
          inputMode="decimal"
          value={s.tauxActualisation}
          onChange={(e) => maj({ tauxActualisation: e.target.value })}
          erreur={erreurs.tauxActualisation}
          aide={t(
            "12 % : valeur de départ du moteur pour la VAN, à confirmer par un expert.",
            "12%: the engine's starting value for NPV, to be confirmed by an expert.",
          )}
        />
      </div>
    </fieldset>
  );
}

function SectionOuverture({ s, maj, erreurs, devise }: SectionProps) {
  const t = useT();
  const langue = useLangue();
  return (
    <fieldset className="mp-plan-saisie">
      <legend>{t("Bilan d'ouverture (facultatif)", "Opening balance sheet (optional)")}</legend>
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Dernier bilan réel (année 0) ; tout est nul par défaut (création d'entreprise). Il doit être équilibré : immobilisations + stocks + créances + trésorerie = capital + réserves + emprunts en cours (année 0) + dettes fournisseurs. Le moteur refuse un bilan déséquilibré.",
          "Last actual balance sheet (year 0); everything is zero by default (new business). It must balance: fixed assets + inventory + receivables + cash = capital + reserves + outstanding loans (year 0) + trade payables. The engine rejects an unbalanced balance sheet.",
        )}
      </p>
      <div className="mp-grille-champs">
        {CLES_OUVERTURE.map((k) => {
          const c = CHAMPS_OUVERTURE[k];
          const nom = langue === "en" ? c.libelleEn : c.libelle;
          return (
            <Champ
              key={k}
              libelle={c.nature === "duree" ? nom : `${nom} (${libelleDevise(devise)})`}
              inputMode={c.nature === "duree" ? "numeric" : "decimal"}
              value={s.ouverture[k]}
              onChange={(e) => maj({ ouverture: { ...s.ouverture, [k]: e.target.value } })}
              erreur={erreurs[`ouverture.${k}`]}
              aide={
                c.nature === "montant_signe"
                  ? t("Signe moins admis.", "Minus sign allowed.")
                  : undefined
              }
            />
          );
        })}
      </div>
    </fieldset>
  );
}

const CHAMPS_ECARTS: { cle: keyof SaisieEcarts; libelle: string; libelleEn: string }[] = [
  {
    cle: "croissance",
    libelle: "Croissance du chiffre d'affaires (points)",
    libelleEn: "Revenue growth (points)",
  },
  { cle: "marge", libelle: "Marge brute (points)", libelleEn: "Gross margin (points)" },
  {
    cle: "variables",
    libelle: "Charges variables (points)",
    libelleEn: "Variable expenses (points)",
  },
  {
    cle: "fixes",
    libelle: "Charges fixes (variation en %)",
    libelleEn: "Fixed expenses (change in %)",
  },
  {
    cle: "delaiClients",
    libelle: "Délai clients (jours)",
    libelleEn: "Customer payment terms (days)",
  },
];

function SectionScenarios({ s, maj, erreurs }: SectionProps) {
  const t = useT();
  const langue = useLangue();
  const groupe = (nom: "optimiste" | "pessimiste", titre: string) => (
    <fieldset className="mp-plan-annuel">
      <legend className="mp-champ__libelle">{titre}</legend>
      <div className="mp-grille-champs mp-grille-champs--serree">
        {CHAMPS_ECARTS.map((c) => (
          <Champ
            key={c.cle}
            libelle={langue === "en" ? c.libelleEn : c.libelle}
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
      <legend>
        {t("Scénarios optimiste et pessimiste", "Optimistic and pessimistic scenarios")}
      </legend>
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Écarts appliqués aux hypothèses de base, chaque année (vide = aucun écart). Valeurs de départ du moteur, à ajuster mission par mission.",
          "Deviations applied to the base assumptions, each year (empty = no deviation). Engine starting values, to be adjusted engagement by engagement.",
        )}
      </p>
      {groupe("optimiste", t("Scénario optimiste", "Optimistic scenario"))}
      {groupe("pessimiste", t("Scénario pessimiste", "Pessimistic scenario"))}
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
  const t = useT();
  const langue = useLangue();
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
  const ctx = { horizon, devise, langue };
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
        messageSpecifique: (err) => messageModele(err, langue),
        apres: (r) => {
          setSimulation(r);
          setAnnonce(
            `${t("Simulation terminée, non enregistrée.", "Simulation completed, not saved.")} ${resumeAlertes(r.resultat, langue)}`,
          );
        },
      },
    );
    setAction(null);
  }

  async function enregistrer() {
    setAction("enregistrer");
    setAnnonce("");
    await f.envoyer(
      fusionnerResultats(validerHypotheses(s, ctx), validerCommentaire(commentaire, langue)),
      (charge) => api.post<VersionModele>(cheminModeles(planId), charge),
      {
        rafraichir: false,
        messageSpecifique: (err) => messageModele(err, langue),
        apres: (v) => {
          setSimulation(null);
          setCommentaire("");
          setAnnonce(
            t(
              `Version ${v.version} enregistrée, non validée : un responsable de la mission doit la valider.${partage ? " Le partage au client a été retiré." : ""}`,
              `Version ${v.version} saved, not approved: an engagement lead must approve it.${partage ? " Sharing with the client was withdrawn." : ""}`,
            ),
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
            ? t(
                `Hypothèses reprises de la version ${versionSource} : modifiez-les puis simulez, ou enregistrez une nouvelle version.`,
                `Assumptions taken from version ${versionSource}: edit them then simulate, or save a new version.`,
              )
            : t(
                "Saisissez les hypothèses, simulez autant de fois que nécessaire, puis enregistrez une version.",
                "Enter the assumptions, simulate as often as needed, then save a version.",
              )}{" "}
          {t(
            `Taux en points (25 pour 25 %), montants en ${libelleDevise(devise)}. Horizon : ${horizon} ans, fixé à la création du plan.`,
            `Rates in points (25 for 25%), amounts in ${libelleDevise(devise)}. Horizon: ${horizon} years, fixed when the plan was created.`,
          )}
        </p>
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur={
            action === "enregistrer"
              ? t("Enregistrement refusé", "Save refused")
              : t("Calcul refusé", "Calculation refused")
          }
        />
        {nbErreurs > 0 && !f.erreurGlobale ? (
          <Alerte
            tonalite="danger"
            titre={t("Hypothèses à corriger", "Assumptions to correct")}
            annonce="alert"
          >
            <p>
              {t(
                `${nbErreurs} champ${nbErreurs > 1 ? "s" : ""} à corriger : chaque erreur est indiquée sous son champ.`,
                `${nbErreurs} field${nbErreurs > 1 ? "s" : ""} to correct: each error is shown under its field.`,
              )}
            </p>
          </Alerte>
        ) : null}

        <SectionActivite {...props} />
        <fieldset className="mp-plan-saisie">
          <legend>{t("Personnel", "Staff")}</legend>
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
          <legend>{t("Investissements", "Investments")}</legend>
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
          <legend>{t("Financement", "Financing")}</legend>
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
          <legend>{t("Calcul", "Calculation")}</legend>
          {peutEnregistrer ? (
            <>
              <AvertissementPartage partage={partage} />
              <ZoneTexte
                libelle={t("Commentaire de version (facultatif)", "Version comment (optional)")}
                rows={2}
                maxLength={COMMENTAIRE_MAX}
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                erreur={f.erreurs.commentaire}
                aide={t(
                  "Ex. « Hypothèses validées avec le dirigeant le 12 mars ». Conservé avec la version.",
                  "E.g. \u201cAssumptions approved with the CEO on March 12\u201d. Kept with the version.",
                )}
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
              texteChargement={t("Calcul en cours…", "Calculating…")}
              disabled={f.enCours}
            >
              {t("Simuler sans enregistrer", "Simulate without saving")}
            </Bouton>
            {peutEnregistrer ? (
              <Bouton
                icone="succes"
                chargement={f.enCours && action === "enregistrer"}
                texteChargement={t("Enregistrement…", "Saving…")}
                disabled={f.enCours}
                onClick={() => void enregistrer()}
              >
                {t("Enregistrer une nouvelle version", "Save a new version")}
              </Bouton>
            ) : null}
          </div>
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "La simulation est recalculée par le moteur de CabinetPilot et n'est pas conservée ; une version enregistrée est figée et horodatée, puis doit être validée par un responsable de la mission.",
              "The simulation is recomputed by the CabinetPilot engine and is not kept; a saved version is frozen and timestamped, then must be approved by an engagement lead.",
            )}
          </p>
        </fieldset>
      </form>

      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>

      {simulation ? (
        <section className="mp-plan__section" aria-labelledby="titre-simulation">
          <h4 id="titre-simulation" ref={refResultat} tabIndex={-1} className="mp-section__titre">
            {t("Résultat de la simulation (non enregistrée)", "Simulation result (not saved)")}
          </h4>
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {t(
                "Simulation non enregistrée : ces chiffres disparaissent si vous quittez la page. Enregistrez une version pour les conserver et les faire valider.",
                "Simulation not saved: these figures disappear if you leave the page. Save a version to keep them and have them approved.",
              )}
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

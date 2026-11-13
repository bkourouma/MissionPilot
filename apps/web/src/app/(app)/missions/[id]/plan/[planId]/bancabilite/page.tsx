import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { GenerationLivrable } from "../../../../../../../components/rapports/GenerationLivrable";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  formaterDate,
  formaterMontantMineur,
  libelleDevise,
} from "../../../../../../../lib/format";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  celluleRatio,
  cheminBancabilite,
  CLES_RATIOS,
  hrefBancabilite,
  libelleRatio,
  libelleVerdict,
  LIGNES_PLAN_FINANCEMENT,
  phraseSeuils,
  TONALITE_VERDICT,
  type Bancabilite,
  type CleRatio,
} from "../../../../../../../lib/plan-bancabilite";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  hrefModele,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Bancabilité du plan", "Plan bankability") };
}

type LigneRatio = { cle: CleRatio } & Record<string, string>;
type LigneFinancement = { libelle: string } & Record<string, string>;

/**
 * Bancabilité (PLA-17) : ratios bancaires, plan de financement et appréciation indicative,
 * calculés par le moteur côté API depuis la dernière version VALIDÉE du modèle financier ; puis
 * génération du dossier bancaire (PDF ou Word). Sans version validée, la page l'explique.
 */
export default async function PageBancabilitePlan({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("plan.lire");
  const [mission, r] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  if (!mission.ok || !r.ok || r.donnees.mission_id !== mission.donnees.id) return null;
  const ctx: ContextePlan = {
    roles: utilisateur.roles,
    utilisateurId: utilisateur.id,
    mission: mission.donnees,
  };
  const droits = droitsPlan(ctx);
  // L'API exige plan.valider pour générer le dossier (document destiné à une banque).
  const peutGenererDossier = aPermission(utilisateur.roles, "plan.valider");
  const b = await chargerServeur<Bancabilite>(cheminBancabilite(planId));
  if (!b.ok && b.statut === 409) {
    return (
      <Alerte tonalite="info" titre={t("Modèle financier à valider", "Financial model to approve")}>
        <p>
          {t(
            "La bancabilité se calcule uniquement sur une version validée du modèle financier, sans aucune nouvelle hypothèse.",
            "Bankability is only computed on an approved version of the financial model, without any new assumption.",
          )}{" "}
          <Link href={hrefModele(id, planId)}>
            {t("Ouvrir le modèle financier", "Open the financial model")}
          </Link>{" "}
          {t(
            "pour faire valider une version par un responsable de la mission.",
            "to have a version approved by an engagement lead.",
          )}
        </p>
      </Alerte>
    );
  }
  if (!b.ok) {
    return (
      <EtatErreur
        titre={t("La bancabilité n'a pas pu être chargée.", "Bankability could not be loaded.")}
        message={b.message}
        hrefReessayer={hrefBancabilite(id, planId)}
      />
    );
  }
  const d = b.donnees;
  const exercices = d.exercices.map((e) => String(e.exercice));
  const lignesRatios: LigneRatio[] = CLES_RATIOS.map((cle) => ({
    cle,
    libelle: libelleRatio(cle, langue),
    ...Object.fromEntries(
      d.exercices.map((e) => [String(e.exercice), celluleRatio(cle, e.ratios[cle], langue)]),
    ),
  }));
  const lignesFinancement: LigneFinancement[] = LIGNES_PLAN_FINANCEMENT.map((l) => ({
    libelle: langue === "en" ? l.libelleEn : l.libelle,
    ...Object.fromEntries(
      d.plan_financement.map((p) => [
        String(p.exercice),
        formaterMontantMineur(l.valeur(p), d.devise, langue),
      ]),
    ),
  }));
  const horsSeuil = CLES_RATIOS.filter((c) => d.hors_seuil[c].length > 0);

  return (
    <>
      <Carte titre={t("Appréciation indicative", "Indicative assessment")} niveauTitre={3}>
        <div className="mp-plan__section">
          <div className="mp-plan__badges">
            <BadgeStatut tonalite={TONALITE_VERDICT[d.verdict]}>
              {libelleVerdict(d.verdict, langue)}
            </BadgeStatut>
            <span className="mp-texte-doux mp-texte-petit">
              {t(
                `Modèle financier version ${d.modele.version}, validé le ${formaterDate(d.modele.validation?.valide_le)} · montants en ${libelleDevise(d.devise)}`,
                `Financial model version ${d.modele.version}, approved on ${formaterDate(d.modele.validation?.valide_le, "UTC", langue)} · amounts in ${libelleDevise(d.devise)}`,
              )}
            </span>
          </div>
          {horsSeuil.length ? (
            <ul
              className="mp-plan__liste-manques"
              aria-label={t("Ratios hors seuil", "Ratios out of threshold")}
            >
              {horsSeuil.map((c) => (
                <li
                  key={c}
                >{`${libelleRatio(c, langue)} : ${t("exercice(s)", "fiscal year(s)")} ${d.hors_seuil[c].join(", ")}`}</li>
              ))}
            </ul>
          ) : (
            <p>
              {t(
                "Tous les ratios calculables respectent les seuils indicatifs.",
                "All computable ratios meet the indicative thresholds.",
              )}
            </p>
          )}
          <p className="mp-texte-doux mp-texte-petit">{phraseSeuils(d.seuils, langue)}</p>
        </div>
      </Carte>
      <Carte titre={t("Ratios bancaires", "Banking ratios")} niveauTitre={3}>
        <Tableau<LigneRatio>
          legende={t("Ratios bancaires par exercice", "Banking ratios by fiscal year")}
          colonnes={[
            { cle: "libelle", entete: t("Ratio", "Ratio") },
            ...exercices.map((x) => ({ cle: x, entete: x, alignement: "droite" as const })),
          ]}
          lignes={lignesRatios}
          cleLigne={(l) => l.cle}
        />
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "« Sans objet » : pas de dette ; « Hors seuil » sans valeur : capitaux propres, EBE ou capacité d'autofinancement nuls ou négatifs. Une valeur n'est jamais remplacée par zéro.",
            "“Not applicable”: no debt; “Out of threshold” with no value: equity, EBITDA or cash flow from operations is zero or negative. A value is never replaced by zero.",
          )}
        </p>
      </Carte>
      <Carte titre={t("Plan de financement", "Financing plan")} niveauTitre={3}>
        <Tableau<LigneFinancement>
          legende={t("Plan de financement par exercice", "Financing plan by fiscal year")}
          colonnes={[
            { cle: "libelle", entete: t("Rubrique", "Line item") },
            ...exercices.map((x) => ({ cle: x, entete: x, alignement: "droite" as const })),
          ]}
          lignes={lignesFinancement}
          cleLigne={(l) => l.libelle}
        />
      </Carte>
      <Carte titre={t("Dossier bancaire", "Bank file")} niveauTitre={3}>
        {peutGenererDossier ? (
          <GenerationLivrable
            type="dossier_bancaire"
            id={planId}
            version={d.modele.version}
            cloturee={droits.cloturee}
          />
        ) : (
          <p className="mp-texte-doux">
            {t(
              "Le dossier bancaire part vers une banque : il est généré par un responsable habilité à valider le plan (associé ou chef de mission). Votre rôle permet de consulter l'analyse ci-dessus.",
              "The bank file goes to a bank: it is generated by a lead authorized to approve the plan (partner or engagement manager). Your role lets you view the analysis above.",
            )}
          </p>
        )}
      </Carte>
    </>
  );
}

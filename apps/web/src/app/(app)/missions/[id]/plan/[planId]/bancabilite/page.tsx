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
import { formaterDate, formaterMontantMineur } from "../../../../../../../lib/format";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  celluleRatio,
  cheminBancabilite,
  CLES_RATIOS,
  hrefBancabilite,
  LIBELLES_RATIOS,
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

export const metadata: Metadata = { title: "Bancabilité du plan" };

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
      <Alerte tonalite="info" titre="Modèle financier à valider">
        <p>
          La bancabilité se calcule uniquement sur une version validée du modèle financier, sans
          aucune nouvelle hypothèse.{" "}
          <Link href={hrefModele(id, planId)}>Ouvrir le modèle financier</Link> pour faire valider
          une version par un responsable de la mission.
        </p>
      </Alerte>
    );
  }
  if (!b.ok) {
    return (
      <EtatErreur
        titre="La bancabilité n'a pas pu être chargée."
        message={b.message}
        hrefReessayer={hrefBancabilite(id, planId)}
      />
    );
  }
  const d = b.donnees;
  const exercices = d.exercices.map((e) => String(e.exercice));
  const lignesRatios: LigneRatio[] = CLES_RATIOS.map((cle) => ({
    cle,
    libelle: LIBELLES_RATIOS[cle],
    ...Object.fromEntries(
      d.exercices.map((e) => [String(e.exercice), celluleRatio(cle, e.ratios[cle])]),
    ),
  }));
  const lignesFinancement: LigneFinancement[] = LIGNES_PLAN_FINANCEMENT.map((l) => ({
    libelle: l.libelle,
    ...Object.fromEntries(
      d.plan_financement.map((p) => [
        String(p.exercice),
        formaterMontantMineur(l.valeur(p), d.devise),
      ]),
    ),
  }));
  const horsSeuil = CLES_RATIOS.filter((c) => d.hors_seuil[c].length > 0);

  return (
    <>
      <Carte titre="Appréciation indicative" niveauTitre={3}>
        <div className="mp-plan__section">
          <div className="mp-plan__badges">
            <BadgeStatut tonalite={TONALITE_VERDICT[d.verdict]}>
              {libelleVerdict(d.verdict)}
            </BadgeStatut>
            <span className="mp-texte-doux mp-texte-petit">
              {`Modèle financier version ${d.modele.version}, validé le ${formaterDate(d.modele.validation?.valide_le)} · montants en ${d.devise}`}
            </span>
          </div>
          {horsSeuil.length ? (
            <ul className="mp-plan__liste-manques" aria-label="Ratios hors seuil">
              {horsSeuil.map((c) => (
                <li
                  key={c}
                >{`${LIBELLES_RATIOS[c]} : exercice(s) ${d.hors_seuil[c].join(", ")}`}</li>
              ))}
            </ul>
          ) : (
            <p>Tous les ratios calculables respectent les seuils indicatifs.</p>
          )}
          <p className="mp-texte-doux mp-texte-petit">{phraseSeuils(d.seuils)}</p>
        </div>
      </Carte>
      <Carte titre="Ratios bancaires" niveauTitre={3}>
        <Tableau<LigneRatio>
          legende="Ratios bancaires par exercice"
          colonnes={[
            { cle: "libelle", entete: "Ratio" },
            ...exercices.map((x) => ({ cle: x, entete: x, alignement: "droite" as const })),
          ]}
          lignes={lignesRatios}
          cleLigne={(l) => l.cle}
        />
        <p className="mp-texte-doux mp-texte-petit">
          « Sans objet » : pas de dette ; « Hors seuil » sans valeur : capitaux propres, EBE ou
          capacité d&apos;autofinancement nuls ou négatifs. Une valeur n&apos;est jamais remplacée
          par zéro.
        </p>
      </Carte>
      <Carte titre="Plan de financement" niveauTitre={3}>
        <Tableau<LigneFinancement>
          legende="Plan de financement par exercice"
          colonnes={[
            { cle: "libelle", entete: "Rubrique" },
            ...exercices.map((x) => ({ cle: x, entete: x, alignement: "droite" as const })),
          ]}
          lignes={lignesFinancement}
          cleLigne={(l) => l.libelle}
        />
      </Carte>
      <Carte titre="Dossier bancaire" niveauTitre={3}>
        {peutGenererDossier ? (
          <GenerationLivrable
            type="dossier_bancaire"
            id={planId}
            version={d.modele.version}
            cloturee={droits.cloturee}
          />
        ) : (
          <p className="mp-texte-doux">
            Le dossier bancaire part vers une banque : il est généré par un responsable habilité à
            valider le plan (associé ou chef de mission). Votre rôle permet de consulter
            l&apos;analyse ci-dessus.
          </p>
        )}
      </Carte>
    </>
  );
}

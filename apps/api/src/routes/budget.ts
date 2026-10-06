import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  comparerVersions,
  creerRevision,
  figerVersion,
  modifierLignesBudget,
} from "@missionpilot/engines";
import {
  aPermission,
  comparaisonQuerySchema,
  NATURES_FINANCE,
  revisionCreationSchema,
  versionLignesSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";
import {
  estAssocie,
  exigerMissionModifiable,
  exigerMissionVisible,
  STATUTS_SIGNES,
  type MissionAcces,
} from "../missions/acces.js";
import {
  calculerDepuisDecoupage,
  chargerVersions,
  estFinance,
  insererLignes,
  lignesDepuisSaisie,
  revelePrixUnitaire,
  roleApprobateurRevision,
  satisfaitRole,
  versionDeReference,
  versVersionMoteur,
  vueVersion,
  type LigneBudgetDb,
  type VersionDb,
} from "../missions/budget.js";
import { aujourdhui, droitsBudget } from "../missions/outils.js";

const paramsVersion = z.object({ id: z.string().uuid(), versionId: z.string().uuid() });

function trouverVersion(versions: VersionDb[], id: string): VersionDb {
  const v = versions.find((x) => x.id === id);
  if (!v) throw introuvable("Version de budget");
  return v;
}

/**
 * Sans « finance.lire », l'utilisateur ne voit ni ne saisit de coûts internes
 * ni de sous-traitance : ses lignes saisies s'ajoutent aux lignes de coûts
 * existantes, qui sont conservées telles quelles.
 */
function fusionnerLignesSaisies(
  auth: Auth,
  saisies: LigneBudgetDb[],
  existantes: LigneBudgetDb[],
): LigneBudgetDb[] {
  if (aPermission(auth.roles, "finance.lire")) return saisies;
  if (saisies.some((l) => estFinance(l.nature))) throw interdit();
  return [...saisies, ...existantes.filter((l) => estFinance(l.nature))];
}

async function exigerMissionSignee(db: Db, auth: Auth, id: string): Promise<MissionAcces> {
  const mission = await exigerMissionModifiable(db, auth, id);
  if (!STATUTS_SIGNES.includes(mission.statut)) {
    throw conflit("Le budget se révise après la signature de la lettre de mission.");
  }
  return mission;
}

const sansIds = (lignes: VersionDb["lignes"]): LigneBudgetDb[] =>
  lignes.map(({ id: _id, ordre: _o, ...l }) => l);

/** Versions de budget (FIN-03), comparaison et seuils d'approbation (FIN-15). */
export const routesBudget: FastifyPluginAsync = async (app) => {
  app.get("/missions/:id/budget", async (request) => {
    const auth = exiger(request, "budget.lire_jours");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      const versions = await chargerVersions(db, id);
      const droits = droitsBudget(auth);
      return {
        devise: mission.devise,
        devise_reference: mission.devise_reference,
        taux_change: mission.taux_change === null ? null : Number(mission.taux_change),
        reference_id: versionDeReference(versions)?.id ?? null,
        en_cours_id: versions.find((v) => !v.figee)?.id ?? null,
        versions: versions.map((v) => vueVersion(v, droits)),
      };
    });
  });

  app.get("/missions/:id/budget/comparaison", async (request) => {
    const auth = exiger(request, "budget.lire_jours");
    const { id } = paramsId.parse(request.params);
    const q = comparaisonQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const versions = await chargerVersions(db, id);
      const avant = trouverVersion(versions, q.avant);
      const apres = trouverVersion(versions, q.apres);
      const c = comparerVersions(versVersionMoteur(avant), versVersionMoteur(apres));
      const droits = droitsBudget(auth);
      const montants = droits.montants || droits.finance;
      // Le moteur apparie les lignes par clé et retient la nature de la ligne
      // « après » : les natures des DEUX côtés sont relues ici pour ne jamais
      // exposer une ligne de coût (ou un prix unitaire) appariée à une autre.
      const cotes = (cle: string) =>
        [avant, apres]
          .map((v) => v.lignes.find((l) => l.cle === cle))
          .filter((l): l is VersionDb["lignes"][number] => l !== undefined);
      const masquee = (cle: string) =>
        !droits.finance && cotes(cle).some((l) => NATURES_FINANCE.includes(l.nature));
      const sansMontant = (cle: string) =>
        !montants || (!droits.finance && cotes(cle).some(revelePrixUnitaire));
      return {
        avant: { id: avant.id, numero: avant.numero, type: avant.type },
        apres: { id: apres.id, numero: apres.numero, type: apres.type },
        ecart_jours_vendus: c.ecartJoursVendus,
        ...(montants ? { ecart_honoraires: c.ecartHonoraires.valeur } : {}),
        ...(droits.finance
          ? { ecart_couts_internes: c.ecartCoutsInternes.valeur, ecart_marge: c.ecartMarge.valeur }
          : {}),
        lignes: c.lignes
          .filter((l) => droits.finance || !NATURES_FINANCE.includes(l.nature))
          .filter((l) => !masquee(l.id))
          .map((l) => ({
            cle: l.id,
            libelle: l.libelle,
            nature: l.nature,
            statut: l.statut,
            jours_avant: l.joursAvant,
            jours_apres: l.joursApres,
            ecart_jours: l.ecartJours,
            ...(!sansMontant(l.id)
              ? {
                  montant_avant: l.montantAvant.valeur,
                  montant_apres: l.montantApres.valeur,
                  ecart_montant: l.ecartMontant.valeur,
                }
              : {}),
          })),
      };
    });
  });

  /** Nouvelle révision (non figée), motif obligatoire ; l'historique est conservé. */
  app.post("/missions/:id/budget/revisions", async (request, reply) => {
    const auth = exiger(request, "budget.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = revisionCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionSignee(db, auth, id);
      const versions = await chargerVersions(db, id);
      if (versions.some((v) => !v.figee)) {
        throw conflit("Une révision est déjà en cours : la valider ou l'abandonner.");
      }
      const reference = versionDeReference(versions);
      if (!reference) throw conflit("La mission n'a pas de budget initial.");
      const lignesSource = sansIds(reference.lignes);
      let lignes = lignesSource;
      if (corps.depuis_decoupage) {
        const prixReference = new Map(
          lignesSource
            .filter((l) => l.nature === "honoraires" && l.prix_journalier !== null)
            .map((l) => [l.cle, l.prix_journalier as number]),
        );
        const calcul = await calculerDepuisDecoupage(db, mission, {
          date: aujourdhui(),
          prixReference,
        });
        lignes = [...calcul.lignes, ...lignesSource.filter((l) => l.montant_forfait !== null)];
      } else if (corps.lignes) {
        lignes = fusionnerLignesSaisies(auth, lignesDepuisSaisie(corps.lignes), lignesSource);
      }
      // Le moteur crée la révision (motif exigé) sans toucher à la source figée.
      const revision = creerRevision(versVersionMoteur(reference), {
        id: "nouvelle",
        type: "revise",
        motif: corps.motif,
        lignes: versVersionMoteur({ ...reference, figee: false, lignes }).lignes,
      });
      const r = await db.query(
        `INSERT INTO budget_versions (cabinet_id, mission_id, numero, type, devise, motif, cree_par)
         VALUES ($1, $2, $3, 'revise', $4, $5, $6) RETURNING id`,
        [auth.cabinetId, id, revision.numero, revision.devise, corps.motif, auth.utilisateurId],
      );
      await insererLignes(db, auth.cabinetId, id, r.rows[0].id, lignes);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation_revision",
        entite: "budget_version",
        entiteId: r.rows[0].id,
        details: { mission_id: id, numero: revision.numero, motif: corps.motif },
      });
      const toutes = await chargerVersions(db, id);
      return vueVersion(trouverVersion(toutes, r.rows[0].id), droitsBudget(auth));
    });
    reply.status(201);
    return creee;
  });

  /** Modifie les lignes d'une révision en cours ; une version figée est refusée par le moteur. */
  app.put("/missions/:id/budget/versions/:versionId/lignes", async (request) => {
    const auth = exiger(request, "budget.ecrire");
    const { id, versionId } = paramsVersion.parse(request.params);
    const corps = versionLignesSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSignee(db, auth, id);
      const version = trouverVersion(await chargerVersions(db, id), versionId);
      const lignes = fusionnerLignesSaisies(
        auth,
        lignesDepuisSaisie(corps.lignes),
        sansIds(version.lignes),
      );
      // Contrôle applicatif : BUDGET_FIGE (409) si la version est figée.
      modifierLignesBudget(
        versVersionMoteur(version),
        versVersionMoteur({ ...version, figee: false, lignes }).lignes,
      );
      await db.query("DELETE FROM budget_lignes WHERE version_id = $1 AND mission_id = $2", [
        versionId,
        id,
      ]);
      await insererLignes(db, auth.cabinetId, id, versionId, lignes);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification_lignes",
        entite: "budget_version",
        entiteId: versionId,
        details: { mission_id: id, lignes: lignes.length },
      });
      const toutes = await chargerVersions(db, id);
      return vueVersion(trouverVersion(toutes, versionId), droitsBudget(auth));
    });
  });

  /**
   * Validation d'une révision (FIN-03) : « budget.reviser », par le directeur
   * désigné de CETTE mission ou un associé, jamais par l'auteur de la révision
   * (sauf associé) ; et le rôle exigé par les seuils d'approbation (FIN-15,
   * moteur) selon les écarts d'honoraires, de coûts et de marge. La version
   * est alors figée.
   */
  app.post("/missions/:id/budget/versions/:versionId/valider", async (request) => {
    const auth = exiger(request, "budget.reviser");
    const { id, versionId } = paramsVersion.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionSignee(db, auth, id);
      const versions = await chargerVersions(db, id);
      const version = trouverVersion(versions, versionId);
      const moteur = versVersionMoteur(version);
      const figee = figerVersion(moteur, aujourdhui());
      const associe = estAssocie(auth);
      if (!associe && mission.directeur_id !== auth.utilisateurId) {
        throw new AppError(
          403,
          "APPROBATION_REQUISE",
          "Cette révision doit être validée par le directeur de la mission ou un associé.",
        );
      }
      if (!associe && version.cree_par === auth.utilisateurId) {
        throw new AppError(
          403,
          "APPROBATION_REQUISE",
          "L'auteur d'une révision ne la valide pas lui-même : la faire valider par un associé.",
        );
      }
      const requis = roleApprobateurRevision(versions, version, mission);
      if (!satisfaitRole(auth.roles, requis)) {
        throw new AppError(
          403,
          "APPROBATION_REQUISE",
          `Cette révision doit être validée par : ${requis === "associe" ? "un associé" : "un directeur de mission ou un associé"}.`,
        );
      }
      await db.query(
        `UPDATE budget_versions SET figee = true, date_figeage = $2, validee_par = $3,
           validee_le = now(), role_approbateur = $4 WHERE id = $1`,
        [versionId, figee.dateFigeage, auth.utilisateurId, requis],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "validation_revision",
        entite: "budget_version",
        entiteId: versionId,
        details: { mission_id: id, numero: version.numero, role_approbateur: requis },
      });
      const toutes = await chargerVersions(db, id);
      return vueVersion(trouverVersion(toutes, versionId), droitsBudget(auth));
    });
  });

  /** Abandon d'une révision en cours (jamais d'une version figée). */
  app.delete("/missions/:id/budget/versions/:versionId", async (request, reply) => {
    const auth = exiger(request, "budget.ecrire");
    const { id, versionId } = paramsVersion.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSignee(db, auth, id);
      const version = trouverVersion(await chargerVersions(db, id), versionId);
      // Même contrôle par le moteur que pour une modification.
      modifierLignesBudget(versVersionMoteur(version), []);
      await db.query("DELETE FROM budget_versions WHERE id = $1 AND mission_id = $2", [
        versionId,
        id,
      ]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "abandon_revision",
        entite: "budget_version",
        entiteId: versionId,
        details: { mission_id: id, numero: version.numero },
      });
    });
    return reply.status(204).send();
  });
};

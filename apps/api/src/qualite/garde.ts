import {
  classeRisqueMax,
  evaluerGarde,
  gardesRequises,
  rangClasseRisque,
  type ClasseRisque,
  type EtapeGarde,
  type EvaluationGarde,
  type ValidationGarde,
  type ViolationGarde,
} from "@missionpilot/engines";
import { ETAPE_GARDE_LIBELLES, aPermission, type EtapeGardeQualite } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit } from "../errors.js";
import {
  modifieToutesLesMissions,
  peutModifierMission,
  type MissionAcces,
} from "../missions/acces.js";
import { lireParametresRapports } from "../rapports/parametres.js";
import { lireContenuLivrable } from "./contenu.js";
import { ajouterEvenement, changerStatut, type Suivi } from "./donnees.js";
import { empreinteJson } from "./empreinte.js";
import { ErreurGarde } from "./erreurs.js";
import { parcoursDe } from "./revue.js";
import { etatDefinition } from "./verification.js";

/*
 * Gardes humaines par classe (QUA-01, QUA-04) et signature (QUA-06). La SÉPARATION DES TÂCHES ne
 * se recode pas ici : chaque validation est jugée par le moteur `evaluerGarde`
 * (packages/engines/src/qualite) avec les validations déjà enregistrées. Le code ne fait que
 * (1) établir l'habilitation de l'acteur à l'étape, (2) exiger le parcours de revue et la
 * définition de terminé, (3) faire avancer le statut du suivi.
 */

export interface ValidationEnregistree {
  etape: EtapeGardeQualite;
  acteur_id: string;
  acteur_nom: string | null;
  commentaire: string | null;
  valide_le: Date;
  /**
   * Un élément obligatoire a été déposé depuis et son auteur ne l'a pas encore parcouru : l'étape
   * est suspendue (la garde n'est pas satisfaite) jusqu'à ce qu'il le parcoure (QUA-03).
   */
  a_reconfirmer: boolean;
}

export async function lireValidations(db: Db, suiviId: string): Promise<ValidationEnregistree[]> {
  const r = await db.query(
    `SELECT v.etape, v.acteur_id, u.nom AS acteur_nom, v.commentaire, v.valide_le,
       EXISTS (SELECT 1 FROM qualite_revue_elements e
               WHERE e.suivi_id = v.suivi_id AND e.obligatoire
                 AND NOT EXISTS (SELECT 1 FROM qualite_revue_vus x
                                 WHERE x.element_id = e.id AND x.utilisateur_id = v.acteur_id))
         AS a_reconfirmer
     FROM qualite_validations v LEFT JOIN utilisateurs u ON u.id = v.acteur_id
     WHERE v.suivi_id = $1 ORDER BY v.valide_le, v.id`,
    [suiviId],
  );
  return r.rows as ValidationEnregistree[];
}

/** Étapes franchies dont l'auteur doit parcourir des éléments déposés depuis. */
export function etapesAReconfirmer(validations: readonly ValidationEnregistree[]): string[] {
  return validations
    .filter((v) => v.a_reconfirmer && v.etape !== "signature_directeur_mission")
    .map((v) => v.etape);
}

/**
 * Le contenu du livrable est-il celui qui a été relu ? Recalcule l'empreinte (module qualité) et
 * la compare à `empreinte_revue`, posée au passage en revue. Type opaque (aucune empreinte) :
 * rien à comparer, la signature porte sur le dossier de revue.
 */
async function contenuInchange(
  db: Db,
  suivi: Suivi,
): Promise<{ inchange: boolean; inconnue: boolean }> {
  const contenu = await lireContenuLivrable(
    db,
    suivi.mission_id,
    suivi.type_livrable as never,
    suivi.livrable_id,
    suivi.version,
  );
  const courante = contenu?.empreinte ?? null;
  if (suivi.empreinte_revue === null) {
    return { inchange: courante === null && contenu !== null, inconnue: courante !== null };
  }
  return { inchange: courante === suivi.empreinte_revue, inconnue: false };
}

/** 409 LIVRABLE_MODIFIE_APRES_REVUE si le contenu n'est plus celui qui a été relu. */
async function exigerContenuRelu(db: Db, suivi: Suivi): Promise<void> {
  const etat = await contenuInchange(db, suivi);
  if (etat.inchange) return;
  throw new AppError(
    409,
    "LIVRABLE_MODIFIE_APRES_REVUE",
    etat.inconnue
      ? "L'empreinte du contenu relu n'est pas encore enregistrée : relancez la vérification de la définition de terminé."
      : "Le livrable a changé depuis son passage en revue : la revue porte sur un autre contenu. Ouvrez un suivi pour la nouvelle version.",
  );
}

const enValidationGarde = (v: ValidationEnregistree[]): ValidationGarde[] =>
  v.map((l) => ({ etape: l.etape as EtapeGarde, acteur: l.acteur_id }));

/** Évaluation de la garde de la classe du suivi avec les validations enregistrées (moteur). */
export function evaluerSuivi(suivi: Suivi, validations: ValidationEnregistree[]): EvaluationGarde {
  return evaluerGarde(suivi.classe as ClasseRisque, enValidationGarde(validations), {
    auteur: suivi.auteur_id,
  });
}

async function estMembreMission(db: Db, auth: Auth, mission: MissionAcces): Promise<boolean> {
  if (mission.directeur_id === auth.utilisateurId || mission.chef_id === auth.utilisateurId)
    return true;
  const r = await db.query(
    "SELECT 1 FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2",
    [mission.id, auth.utilisateurId],
  );
  return r.rows.length > 0;
}

/**
 * Habilitation de l'acteur à tenir le rôle de l'étape sur cette mission (le moteur ne connaît pas
 * les rôles : l'appelant le lui dit).
 */
export async function habilitePour(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  etape: EtapeGardeQualite,
): Promise<boolean> {
  const associe = auth.roles.includes("associe");
  switch (etape) {
    case "validation_auteur":
    case "validation_consultant":
      return modifieToutesLesMissions(auth) || (await estMembreMission(db, auth, mission));
    case "relecture_chef_mission":
      return (
        aPermission(auth.roles, "qualite.relire") &&
        (associe ||
          mission.chef_id === auth.utilisateurId ||
          mission.directeur_id === auth.utilisateurId)
      );
    case "revue_second_expert":
      return aPermission(auth.roles, "qualite.relire");
    case "signature_directeur_mission":
      return (
        aPermission(auth.roles, "qualite.signer") &&
        (associe || mission.directeur_id === auth.utilisateurId)
      );
  }
}

/** Étapes qui exigent « qualite.relire » (les deux premières n'exigent que l'appartenance à la mission). */
const ETAPES_AVEC_DROIT_QUALITE: readonly EtapeGardeQualite[] = [
  "relecture_chef_mission",
  "revue_second_expert",
];

function messageViolations(violations: readonly ViolationGarde[]): string {
  const libelle = (v: ViolationGarde): string => {
    const roles = v.roles
      .map((r) => (r === "auteur" ? "l'auteur" : ETAPE_GARDE_LIBELLES[r]))
      .join(" et ");
    switch (v.code) {
      case "QUATRE_YEUX":
        return `quatre yeux : le second expert ne peut être ${roles}`;
      case "CUMUL_INTERDIT":
        return `une même personne ne cumule pas ${roles}`;
      case "AUTEUR_ATTENDU":
        return "la validation de l'auteur revient à l'auteur du contenu";
      case "ETAPE_EN_DOUBLE":
        return `étape déjà franchie : ${roles}`;
      default:
        return `acteur non habilité : ${roles}`;
    }
  };
  return `Garde non respectée : ${violations.map(libelle).join(" ; ")}.`;
}

/** Relève la classe de risque (jamais en dessous de la classe actuelle ni de la classe minimale). */
export async function releverClasse(
  db: Db,
  auth: Auth,
  suivi: Suivi,
  mission: MissionAcces,
  classe: ClasseRisque,
  motif: string,
): Promise<ClasseRisque> {
  if (!peutModifierMission(auth, mission)) throw interdit();
  if (suivi.statut !== "brouillon" && suivi.statut !== "en_revue") {
    throw new AppError(
      409,
      "SUIVI_NON_MODIFIABLE",
      "La classe ne se relève plus une fois le livrable validé.",
    );
  }
  const actuelle = suivi.classe as ClasseRisque;
  if (rangClasseRisque(classe) < rangClasseRisque(actuelle)) {
    throw new AppError(
      409,
      "CLASSE_ABAISSEE",
      "La classe de risque se relève, elle ne s'abaisse jamais.",
    );
  }
  if (classe === actuelle) throw conflit("Le livrable est déjà de cette classe.");
  const max = classeRisqueMax([classe, suivi.classe_minimale as ClasseRisque]);
  await db.query("UPDATE qualite_suivis SET classe = $2, modifie_le = now() WHERE id = $1", [
    suivi.id,
    max,
  ]);
  await ajouterEvenement(db, auth.cabinetId, suivi.id, auth.utilisateurId, {
    action: "relevement_classe",
    details: { de: actuelle, a: max, motif },
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.classe.relever",
    entite: "qualite_suivi",
    entiteId: suivi.id,
    details: { de: actuelle, a: max },
  });
  return max as ClasseRisque;
}

/** Faut-il encore des étapes humaines (hors signature) avant que le suivi soit « validé » ? */
function etapesRestantes(evaluation: EvaluationGarde): EtapeGarde[] {
  return evaluation.manquantes.filter((e) => e !== "signature_directeur_mission");
}

/**
 * Passe le suivi à « validé » dès que toutes les étapes humaines (hors signature) sont franchies,
 * sans violation, et que la définition de terminé est satisfaite. Une garde automatique (R0) se
 * clôt ainsi à la vérification, avec son événement journalisé.
 */
export async function validerSiGardeSatisfaite(db: Db, auth: Auth, suivi: Suivi): Promise<boolean> {
  if (suivi.statut !== "en_revue") return false;
  const validations = await lireValidations(db, suivi.id);
  const evaluation = evaluerSuivi(suivi, validations);
  if (etapesRestantes(evaluation).length > 0 || evaluation.violations.length > 0) return false;
  if (etapesAReconfirmer(validations).length > 0) return false;
  if (!(await etatDefinition(db, suivi)).satisfaite) return false;
  if (!(await contenuInchange(db, suivi)).inchange) return false;
  await changerStatut(db, suivi.id, "valide");
  await ajouterEvenement(db, auth.cabinetId, suivi.id, auth.utilisateurId, {
    action: "validation_complete",
    details: { classe: suivi.classe, automatique: evaluation.automatique },
  });
  suivi.statut = "valide";
  return true;
}

/** Enregistre une étape de garde : habilitation, définition, parcours, moteur, puis ligne en ajout seul. */
export async function validerEtape(
  db: Db,
  auth: Auth,
  suivi: Suivi,
  mission: MissionAcces,
  etape: EtapeGardeQualite,
  commentaire: string | null,
): Promise<{ evaluation: EvaluationGarde; valide: boolean }> {
  if (suivi.statut !== "en_revue") {
    throw new AppError(
      409,
      "SUIVI_NON_EN_REVUE",
      "Le livrable n'est pas en revue : lancez d'abord la vérification de la définition de terminé.",
    );
  }
  if (etape === "signature_directeur_mission") {
    throw conflit("La signature du directeur de mission se fait par la route de signature.");
  }
  if (ETAPES_AVEC_DROIT_QUALITE.includes(etape) && !aPermission(auth.roles, "qualite.relire")) {
    throw interdit();
  }
  const habilite = await habilitePour(db, auth, mission, etape);
  if (!habilite) throw interdit();

  const existantes = await lireValidations(db, suivi.id);
  const requises = gardesRequises(suivi.classe as ClasseRisque).etapes;
  if (!requises.includes(etape)) {
    throw conflit(`Cette étape n'est pas requise pour la classe ${suivi.classe}.`);
  }
  const avant = evaluerSuivi(suivi, existantes);
  const suspendue = existantes.find((v) => v.etape === etape && v.a_reconfirmer);
  if (suspendue) {
    throw new AppError(
      409,
      "ETAPE_A_RECONFIRMER",
      "Cette étape est déjà franchie mais des éléments ont été déposés depuis : son auteur les parcourt pour la reconfirmer.",
    );
  }
  if (avant.prochaineEtape !== etape) {
    throw conflit(
      avant.etapesFaites.includes(etape)
        ? "Cette étape a déjà été franchie."
        : `Étape hors ordre : la prochaine étape de la garde est « ${
            avant.prochaineEtape ? ETAPE_GARDE_LIBELLES[avant.prochaineEtape] : "aucune"
          } ».`,
    );
  }
  const evaluation = evaluerGarde(
    suivi.classe as ClasseRisque,
    [...enValidationGarde(existantes), { etape, acteur: auth.utilisateurId, habilite }],
    { auteur: suivi.auteur_id },
  );
  if (evaluation.violations.length > 0) {
    throw new ErreurGarde(messageViolations(evaluation.violations), evaluation.violations);
  }
  await exigerPrerequis(db, auth, suivi);

  await db.query(
    `INSERT INTO qualite_validations (cabinet_id, suivi_id, etape, acteur_id, commentaire)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, suivi.id, etape, auth.utilisateurId, commentaire],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.valider",
    entite: "qualite_suivi",
    entiteId: suivi.id,
    details: { etape, classe: suivi.classe },
  });
  const valide = await validerSiGardeSatisfaite(db, auth, suivi);
  return { evaluation, valide };
}

/**
 * Contenu inchangé depuis le passage en revue, définition de terminé satisfaite, parcours de revue
 * NON VIDE pour un livrable client (R2, R3 ; doublé en base, MPY08) et complet pour le relecteur
 * (409 sinon).
 */
async function exigerPrerequis(db: Db, auth: Auth, suivi: Suivi): Promise<void> {
  await exigerContenuRelu(db, suivi);
  const def = await etatDefinition(db, suivi);
  if (!def.satisfaite) {
    throw new AppError(
      409,
      "DEFINITION_NON_SATISFAITE",
      `La définition de terminé n'est pas satisfaite (${def.bloquants.length} item(s) bloquant(s)).`,
    );
  }
  const parcours = await parcoursDe(db, suivi.id, auth.utilisateurId);
  if (
    rangClasseRisque(suivi.classe as ClasseRisque) >= rangClasseRisque("R2") &&
    parcours.obligatoires === 0
  ) {
    throw new AppError(
      409,
      "PARCOURS_VIDE",
      "Aucun élément obligatoire à parcourir : un livrable client (R2, R3) ne se valide pas sur une revue vide. Déposez les assertions, chiffres ou recommandations à relire.",
    );
  }
  if (!parcours.complet) {
    throw new AppError(
      409,
      "PARCOURS_INCOMPLET",
      `Parcourez d'abord tous les éléments obligatoires de la revue (${parcours.restants} restant(s) sur ${parcours.obligatoires}).`,
    );
  }
}

export interface SignatureEnregistree {
  id: string;
  signataire_id: string;
  signataire_nom: string | null;
  qualite: string;
  version: number;
  empreinte_sha256: string;
  portee_empreinte: string;
  mention_ia: string | null;
  signe_le: Date;
}

export async function lireSignature(db: Db, suiviId: string): Promise<SignatureEnregistree | null> {
  const r = await db.query(
    `SELECT s.id, s.signataire_id, u.nom AS signataire_nom, s.qualite, s.version, s.empreinte_sha256,
       s.portee_empreinte, s.mention_ia, s.signe_le
     FROM qualite_signatures s LEFT JOIN utilisateurs u ON u.id = s.signataire_id WHERE s.suivi_id = $1`,
    [suiviId],
  );
  return (r.rows[0] as SignatureEnregistree | undefined) ?? null;
}

/**
 * Empreinte à apposer : celle du CONTENU quand le module qualité sait le lire (vérifiable par
 * quiconque en recalculant la somme du livrable), sinon celle du dossier de revue seul.
 */
async function calculerEmpreinte(
  db: Db,
  suivi: Suivi,
  validations: ValidationEnregistree[],
): Promise<{ empreinte: string; portee: "contenu" | "dossier_qualite" }> {
  const contenu = await lireContenuLivrable(
    db,
    suivi.mission_id,
    suivi.type_livrable as never,
    suivi.livrable_id,
    suivi.version,
  );
  if (contenu?.empreinte) return { empreinte: contenu.empreinte, portee: "contenu" };
  const elements = await db.query(
    `SELECT cle, kind, libelle, obligatoire, source FROM qualite_revue_elements
     WHERE suivi_id = $1 ORDER BY cle`,
    [suivi.id],
  );
  const def = await etatDefinition(db, suivi);
  return {
    portee: "dossier_qualite",
    empreinte: empreinteJson({
      livrable: {
        type: suivi.type_livrable,
        id: suivi.livrable_id,
        version: suivi.version,
        mission: suivi.mission_id,
        classe: suivi.classe,
      },
      validations: validations.map((v) => ({
        etape: v.etape,
        acteur: v.acteur_id,
        le: v.valide_le,
      })),
      elements: elements.rows,
      definition: def.items.map((i) => ({ code: i.code, statut: i.statut })),
    }),
  };
}

/** Signature du livrable validé (QUA-06) ; pour la classe R3, c'est aussi l'étape de garde finale. */
export async function signerSuivi(
  db: Db,
  auth: Auth,
  suivi: Suivi,
  mission: MissionAcces,
  commentaire: string | null,
): Promise<SignatureEnregistree> {
  if (suivi.statut !== "valide") {
    throw new AppError(409, "SUIVI_NON_VALIDE", "Seul un livrable validé peut être signé.");
  }
  const classe = suivi.classe as ClasseRisque;
  if (rangClasseRisque(classe) < rangClasseRisque("R2")) {
    throw new AppError(
      409,
      "SIGNATURE_NON_APPLICABLE",
      "La signature concerne les livrables clients (classes R2 et R3).",
    );
  }
  if (!(await habilitePour(db, auth, mission, "signature_directeur_mission"))) throw interdit();
  const existantes = await lireValidations(db, suivi.id);
  if (etapesAReconfirmer(existantes).length > 0) {
    throw new AppError(
      409,
      "ETAPE_A_RECONFIRMER",
      "Des étapes de garde sont à reconfirmer : leurs auteurs parcourent d'abord les éléments déposés depuis.",
    );
  }
  const garde = gardesRequises(classe);
  if (garde.signature) {
    const evaluation = evaluerGarde(
      classe,
      [
        ...enValidationGarde(existantes),
        { etape: "signature_directeur_mission", acteur: auth.utilisateurId, habilite: true },
      ],
      { auteur: suivi.auteur_id },
    );
    if (evaluation.violations.length > 0) {
      throw new ErreurGarde(messageViolations(evaluation.violations), evaluation.violations);
    }
  }
  await exigerPrerequis(db, auth, suivi);
  const { empreinte, portee } = await calculerEmpreinte(db, suivi, existantes);
  const mention = (await lireParametresRapports(db)).mention_effective;
  if (garde.signature) {
    await db.query(
      `INSERT INTO qualite_validations (cabinet_id, suivi_id, etape, acteur_id, commentaire)
       VALUES ($1, $2, 'signature_directeur_mission', $3, $4)`,
      [auth.cabinetId, suivi.id, auth.utilisateurId, commentaire],
    );
  }
  const qualite = mission.directeur_id === auth.utilisateurId ? "directeur_mission" : "associe";
  await db.query(
    `INSERT INTO qualite_signatures
       (cabinet_id, suivi_id, signataire_id, qualite, version, empreinte_sha256, portee_empreinte, mention_ia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      suivi.id,
      auth.utilisateurId,
      qualite,
      suivi.version,
      empreinte,
      portee,
      mention,
    ],
  );
  await changerStatut(db, suivi.id, "signe");
  await ajouterEvenement(db, auth.cabinetId, suivi.id, auth.utilisateurId, {
    action: "signature",
    details: { qualite, portee, empreinte },
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.signer",
    entite: "qualite_suivi",
    entiteId: suivi.id,
    details: { classe, qualite, portee, empreinte, version: suivi.version },
  });
  suivi.statut = "signe";
  return (await lireSignature(db, suivi.id)) as SignatureEnregistree;
}

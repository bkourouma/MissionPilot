import { ajouterJours, gardesRequises, type EtapeGarde } from "@missionpilot/engines";
import { CLASSE_MINIMALE_PAR_TYPE } from "@missionpilot/shared";
import { empreinteJson } from "../../../qualite/empreinte.js";
import { abreger } from "../../../qualite/texte.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { CASTING, compterLignes } from "./commun.js";
import type { SuiviSpec } from "./qualite-donnees.js";
import { ELEMENTS } from "./qualite-elements.js";
import {
  ATTESTATIONS,
  COMMENTAIRES,
  deposer,
  evenement,
  parcours,
  statut,
  verification,
  type Contexte,
} from "./qualite-historique-ecritures.js";
import {
  Chrono,
  distribuer,
  jourOuvre,
  transaction,
  uuidStable,
  type Acteur,
  type InfoMission,
} from "./qualite-outils.js";

/*
 * Historique d'un suivi qualité écrit par le rôle propriétaire (SQL paramétré, tables en dur) :
 * les routes datent tout « maintenant » et ces historiques sont en ajout seul (déclencheurs
 * MPY01), donc chaque ligne est insérée avec sa date. L'enchaînement reproduit celui de l'API
 * (ouverture, éléments, vérification, attestations, parcours, étapes de la garde, validation,
 * signature) et la séparation des tâches vient du même moteur de garde (`distribuer`).
 */

/** Date de départ du suivi (jour ouvré) à partir des dates de la mission. */
export function dateOuverture(spec: SuiviSpec, debut: string, fin: string): string {
  return jourOuvre(ajouterJours(spec.depuis === "debut" ? debut : fin, spec.jours));
}

export interface Definitions {
  /** Version la plus récente de la définition « état » née avant `iso` : id et items (code, id, controle). */
  etat(
    iso: string,
  ): Promise<{ id: string; items: { id: string; code: string; controle: string }[] }>;
}

export async function ecrireSuivi(
  ctx: ContexteTenantDemo,
  spec: SuiviSpec,
  info: InfoMission,
  defs: Definitions,
  mention: string | null,
): Promise<boolean> {
  const livrableId = uuidStable("qualite", info.mission.id, spec.cle);
  const dejaLa = await compterLignes(
    ctx,
    "SELECT count(*) AS n FROM qualite_suivis WHERE type_livrable = $1 AND livrable_id = $2 AND version = 1",
    [spec.type, livrableId],
  );
  if (dejaLa > 0) return false;
  const { debut, fin } = CASTING[spec.mission];
  const terminee = CASTING[spec.mission].etat === "terminee";
  const alea = ctx.alea.deriver(`qualite:suivi:${spec.mission}:${spec.cle}`);
  const depart = dateOuverture(spec, info.mission.debut ?? debut, info.mission.fin ?? fin);
  const chrono = new Chrono(
    depart,
    alea,
    terminee ? ajouterJours(info.mission.fin ?? fin, -1) : ctx.aujourdhui,
  );
  const d = distribuer(ctx, info, spec.classe, chrono.date());

  await transaction(ctx, async () => {
    const minimale = CLASSE_MINIMALE_PAR_TYPE[spec.type];
    const def = spec.type === "etat" ? await defs.etat(chrono.iso()) : null;
    const ouvert = chrono.iso();
    const s = await ctx.proprietaire.query<{ id: string }>(
      `INSERT INTO qualite_suivis (cabinet_id, mission_id, type_livrable, livrable_id, libelle, version,
         classe_minimale, classe, statut, auteur_id, definition_id, ouvert_par, ouvert_le, modifie_le)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6, 'brouillon', $7, $8, $9, $10, $10) RETURNING id`,
      [
        ctx.cabinetId,
        info.mission.id,
        spec.type,
        livrableId,
        spec.libelle,
        minimale,
        d.auteur.id,
        def?.id ?? null,
        d.ouvreur.id,
        ouvert,
      ],
    );
    const c: Contexte = { ctx, suiviId: s.rows[0]!.id, chrono, alea };
    await evenement(
      c,
      "ouverture",
      { classe: minimale, classe_minimale: minimale },
      d.ouvreur,
      ouvert,
    );
    if (spec.classe !== minimale) {
      if (!spec.releve) throw new Error(`Suivi « ${spec.cle} » : relèvement de classe sans motif.`);
      chrono.minutes(12);
      await ctx.proprietaire.query(
        "UPDATE qualite_suivis SET classe = $2, modifie_le = $3 WHERE id = $1",
        [c.suiviId, spec.classe, chrono.iso()],
      );
      await evenement(
        c,
        "relevement_classe",
        { de: minimale, a: spec.classe, motif: spec.releve },
        d.ouvreur,
        chrono.iso(),
      );
    }
    if (spec.etat === "brouillon") return;

    // Éléments à parcourir (assertions, chiffres, recommandations) déposés par l'ouvreur.
    const modeles = ELEMENTS[spec.theme].map((m, i) =>
      spec.nonConforme &&
      m.kind === "chiffre" &&
      i === ELEMENTS[spec.theme].findIndex((x) => x.kind === "chiffre")
        ? { kind: m.kind, libelle: m.libelle }
        : m,
    );
    const premiers = spec.reverification ? modeles.filter((m) => m.kind !== "chiffre") : modeles;
    const chiffres = spec.reverification ? modeles.filter((m) => m.kind === "chiffre") : [];
    chrono.minutes(25);
    const elements = await deposer(c, spec, d.ouvreur, premiers, 0);

    // Vérification de la définition de terminé et passage en revue.
    chrono.jours(1);
    const items = def?.items ?? [];
    const codeChiffres = items.find((i) => i.controle === "chiffres_traces");
    const sansSource = elements.filter((e) => e.kind === "chiffre" && !e.source);
    const aDesChiffres = elements.some((e) => e.kind === "chiffre");
    if (codeChiffres) {
      if (!aDesChiffres) {
        await verification(
          c,
          codeChiffres.id,
          1,
          "non_evaluable",
          "Aucun chiffre déposé dans la revue guidée : à attester.",
          chrono.iso(),
        );
      } else if (sansSource.length > 0) {
        await verification(
          c,
          codeChiffres.id,
          1,
          "non_conforme",
          `${sansSource.length} chiffre(s) sans source vérifiée (moteur ou preuve) : ${sansSource
            .map((e) => abreger(e.libelle))
            .slice(0, 3)
            .join(" ; ")}.`,
          chrono.iso(),
        );
      } else {
        await verification(c, codeChiffres.id, 1, "conforme", null, chrono.iso());
      }
    }
    await statut(c, "en_revue", chrono.iso());
    await evenement(c, "passage_en_revue", {}, d.ouvreur, chrono.iso());
    let tous = elements;
    if (chiffres.length > 0) {
      chrono.jours(1);
      tous = [...elements, ...(await deposer(c, spec, d.ouvreur, chiffres, elements.length))];
      if (codeChiffres)
        await verification(c, codeChiffres.id, 2, "conforme", null, chrono.minutes(8).iso());
    }

    // Attestations des items « manuel » par un relecteur qui n'est pas l'auteur (MPY10).
    const manuels = items.filter((i) => i.controle === "manuel");
    const nbAttestes =
      spec.etat === "en_revue" ? (spec.attestes ?? manuels.length) : manuels.length;
    for (const [k, item] of manuels.slice(0, nbAttestes).entries()) {
      const par = k % 2 === 0 ? d.relecture_chef_mission : d.revue_second_expert;
      chrono.jours(1);
      await c.ctx.proprietaire.query(
        `INSERT INTO qualite_verifications (cabinet_id, suivi_id, item_id, rang, statut, detail, par, le)
         VALUES ($1, $2, $3, 1, 'atteste', $4, $5, $6)`,
        [
          ctx.cabinetId,
          c.suiviId,
          item.id,
          ATTESTATIONS[item.code] ?? "Item vérifié par le relecteur.",
          par.id,
          chrono.iso(),
        ],
      );
    }

    // Étapes humaines de la garde (hors signature), chacune après le parcours complet de l'acteur.
    const etapes = gardesRequises(spec.classe).etapes.filter(
      (e) => e !== "signature_directeur_mission",
    );
    const nbEtapes = spec.etat === "en_revue" ? (spec.etapes ?? 0) : etapes.length;
    const faits: { etape: EtapeGarde; acteur: Acteur; le: string }[] = [];
    for (const etape of etapes.slice(0, nbEtapes)) {
      const acteurEtape = d[etape];
      chrono.jours(1);
      if (!faits.some((f) => f.acteur.id === acteurEtape.id))
        await parcours(c, acteurEtape, tous, 1);
      chrono.minutes(5);
      const textes = COMMENTAIRES[etape] ?? ["Étape validée."];
      await ctx.proprietaire.query(
        `INSERT INTO qualite_validations (cabinet_id, suivi_id, etape, acteur_id, commentaire, valide_le)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.cabinetId, c.suiviId, etape, acteurEtape.id, alea.choisir(textes), chrono.iso()],
      );
      faits.push({ etape, acteur: acteurEtape, le: chrono.iso() });
    }
    if (spec.etat === "en_revue") {
      // Revue en cours : le prochain relecteur a parcouru une partie des éléments.
      const prochain = etapes[nbEtapes];
      if (prochain && !faits.some((f) => f.acteur.id === d[prochain].id)) {
        chrono.jours(1);
        await parcours(c, d[prochain], tous, 0.5);
      }
      return;
    }

    if (etapes.length > 0 || spec.classe === "R0") {
      chrono.minutes(4);
      await statut(c, "valide", chrono.iso());
      await evenement(
        c,
        "validation_complete",
        { classe: spec.classe, automatique: false },
        faits[faits.length - 1]?.acteur ?? d.auteur,
        chrono.iso(),
      );
    }
    if (spec.etat !== "signe") return;

    // Signature du livrable validé (QUA-06) : empreinte du dossier de revue (type opaque).
    const g = gardesRequises(spec.classe);
    const signataire = d.signature_directeur_mission;
    chrono.jours(1);
    if (!faits.some((f) => f.acteur.id === signataire.id)) await parcours(c, signataire, tous, 1);
    chrono.minutes(6);
    if (g.signature) {
      await ctx.proprietaire.query(
        `INSERT INTO qualite_validations (cabinet_id, suivi_id, etape, acteur_id, commentaire, valide_le)
         VALUES ($1, $2, 'signature_directeur_mission', $3, $4, $5)`,
        [
          ctx.cabinetId,
          c.suiviId,
          signataire.id,
          alea.choisir(COMMENTAIRES.signature_directeur_mission ?? ["Signé."]),
          chrono.iso(),
        ],
      );
    }
    const empreinte = empreinteJson({
      livrable: {
        type: spec.type,
        id: livrableId,
        version: 1,
        mission: info.mission.id,
        classe: spec.classe,
      },
      validations: faits.map((f) => ({ etape: f.etape, acteur: f.acteur.id, le: f.le })),
      elements: tous.map((e) => ({
        cle: e.cle,
        kind: e.kind,
        libelle: e.libelle,
        obligatoire: true,
        source: e.source,
      })),
    });
    const qualite = info.directeur.id === signataire.id ? "directeur_mission" : "associe";
    await ctx.proprietaire.query(
      `INSERT INTO qualite_signatures (cabinet_id, suivi_id, signataire_id, qualite, version, empreinte_sha256,
         portee_empreinte, mention_ia, signe_le)
       VALUES ($1, $2, $3, $4, 1, $5, 'dossier_qualite', $6, $7)`,
      [ctx.cabinetId, c.suiviId, signataire.id, qualite, empreinte, mention, chrono.iso()],
    );
    await statut(c, "signe", chrono.iso());
    await evenement(
      c,
      "signature",
      { qualite, portee: "dossier_qualite", empreinte },
      signataire,
      chrono.iso(),
    );
  });
  return true;
}

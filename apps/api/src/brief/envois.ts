import { comparer, zero, type CandidatBrief } from "@missionpilot/engines";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
} from "../finance/paiements.js";
import {
  a,
  base,
  donneesFinancieres,
  enSource,
  enSourceFiltree,
  JOUR,
  PLAFOND_PAR_SOURCE,
  texte,
  VISIBLE,
  type Extracteur,
} from "./commun.js";

/*
 * Famille « Prêt à envoyer » : ce que l'utilisateur peut envoyer ou publier et qui attend déjà,
 * validé. Seuls des objets dont le STATUT dit « prêt, pas encore parti » sont repris (proposition
 * validée, facture approuvée ou émise non envoyée, relance préparée, demande de pièces en
 * brouillon). Un livrable signé n'a pas de trace de diffusion : il n'est signalé que dans une
 * fenêtre courte après sa signature.
 */

/** Une facture émise non envoyée n'est signalée que pendant cette fenêtre (jours) ; à valider. */
export const FENETRE_FACTURE_A_ENVOYER_JOURS = 30;
/** Un livrable signé est « à transmettre » pendant cette fenêtre (jours) ; à valider. */
export const FENETRE_LIVRABLE_SIGNE_JOURS = 7;

/** Proposition validée par un associé et pas encore envoyée au client (MIS-05). */
export const propositionsAEnvoyer: Extracteur = async (c) => {
  if (!a(c, "pipeline.gerer")) return null;
  const r = await c.db.query(
    `SELECT p.id, p.numero, p.intitule, ${JOUR("p.validee_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM propositions p
     WHERE p.statut = 'validee'
     ORDER BY p.validee_le, p.id LIMIT $1`,
    [PLAFOND_PAR_SOURCE],
  );
  return enSource("envoyer", r.rows, (l) => ({
    type: "proposition_a_envoyer",
    entite_id: l.id as string,
    mission_id: null,
    entite_libelle: `${String(l.intitule)} (version ${String(l.numero)})`,
    mission_libelle: null,
    lien: `/pipeline/propositions/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

/** Facture approuvée (FIN-15), prête à émettre par qui détient « facture.emettre ». */
export const facturesAEmettre: Extracteur = async (c) => {
  if (!a(c, "facture.emettre")) return null;
  const r = await c.db.query(
    `SELECT f.id, f.mission_id, m.intitule, ${JOUR("f.approuvee_le")} AS depuis, f.net_a_payer,
       f.devise, count(*) OVER ()::int AS total_source
     FROM factures f JOIN missions m ON m.id = f.mission_id
     WHERE f.statut = 'approuvee' AND ${VISIBLE}
     ORDER BY f.approuvee_le, f.id LIMIT $3`,
    [...base(c), PLAFOND_PAR_SOURCE],
  );
  return enSource("envoyer", r.rows, (l) => ({
    type: "facture_a_emettre",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: null,
    mission_libelle: texte(l.intitule),
    lien: `/facturation/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
    ...donneesFinancieres(c, l.net_a_payer, l.devise),
  }));
};

/** Facture émise récemment, jamais envoyée au client. */
export const facturesAEnvoyer: Extracteur = async (c) => {
  if (!a(c, "facture.emettre")) return null;
  const r = await c.db.query(
    `SELECT f.id, f.numero, f.mission_id, m.intitule, ${JOUR("f.emise_le")} AS depuis,
       f.net_a_payer, f.devise, count(*) OVER ()::int AS total_source
     FROM factures f JOIN missions m ON m.id = f.mission_id
     WHERE f.statut = 'emise' AND f.envoyee_le IS NULL
       AND f.emise_le >= $3::date - $4::int AND ${VISIBLE}
     ORDER BY f.emise_le, f.id LIMIT $5`,
    [...base(c), c.date, FENETRE_FACTURE_A_ENVOYER_JOURS, PLAFOND_PAR_SOURCE],
  );
  return enSource("envoyer", r.rows, (l) => ({
    type: "facture_a_envoyer",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.numero),
    mission_libelle: texte(l.intitule),
    lien: `/facturation/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
    ...donneesFinancieres(c, l.net_a_payer, l.devise),
  }));
};

/**
 * Relance de facture préparée avec son e-mail mais non envoyée (envoi automatique désactivé,
 * FIN-09) : la dernière relance de la facture, tant que la facture n'est pas soldée (moteur).
 * Le texte de l'e-mail n'est pas lu.
 */
export const relancesPretes: Extracteur = async (c) => {
  if (!a(c, "encaissement.gerer")) return null;
  const r = await c.db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT}, m.intitule, x.id AS relance_id,
       ${JOUR("x.cree_le")} AS depuis, count(*) OVER ()::int AS total_source
     FROM (SELECT DISTINCT ON (r.facture_id) r.id, r.facture_id, r.cree_le, r.email_envoye,
                  r.destinataire_email
           FROM relances_factures r ORDER BY r.facture_id, r.cree_le DESC, r.id DESC) x
     JOIN factures f ON f.id = x.facture_id JOIN missions m ON m.id = f.mission_id
     WHERE NOT x.email_envoye AND x.destinataire_email IS NOT NULL AND f.statut = 'emise'
       AND ${VISIBLE}
     ORDER BY x.cree_le, x.id LIMIT $3`,
    [...base(c), PLAFOND_PAR_SOURCE],
  );
  const lignes = r.rows as Record<string, unknown>[];
  const factures = lignes.map(versFacturePaiement);
  const imputations = await imputationsParFacture(
    c.db,
    factures.map((f) => f.id),
    c.date,
  );
  const candidats: CandidatBrief[] = [];
  for (const [i, f] of factures.entries()) {
    const situation = situationPaiement(f, imputations.get(f.id) ?? [], c.date);
    if (comparer(situation.solde, zero(situation.solde.devise)) <= 0) continue;
    candidats.push({
      type: "relance_prete",
      entite_id: String(lignes[i]?.relance_id),
      mission_id: f.mission_id,
      entite_libelle: f.numero,
      mission_libelle: texte(lignes[i]?.intitule),
      lien: `/facturation/${f.id}`,
      faits: { nature: "attente", depuis: texte(lignes[i]?.depuis) },
      ...(c.avecFinance ? { montant: situation.solde.valeur, devise: situation.solde.devise } : {}),
    });
  }
  return enSourceFiltree("envoyer", lignes, candidats);
};

/** Demande de pièces préparée (au moins une pièce), pas encore envoyée au client (CLI-01). */
export const demandesSalleAEnvoyer: Extracteur = async (c) => {
  if (!a(c, "salle.gerer")) return null;
  const r = await c.db.query(
    `SELECT d.id, d.titre, d.mission_id, m.intitule, ${JOUR("d.modifie_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM salle_demandes d JOIN missions m ON m.id = d.mission_id
     WHERE d.statut = 'brouillon' AND m.statut <> 'cloturee' AND ${VISIBLE}
       AND EXISTS (SELECT 1 FROM salle_pieces p WHERE p.demande_id = d.id)
     ORDER BY d.modifie_le, d.id LIMIT $3`,
    [...base(c), PLAFOND_PAR_SOURCE],
  );
  return enSource("envoyer", r.rows, (l) => ({
    type: "demande_salle_a_envoyer",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.titre),
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}/salle/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

/**
 * Livrable signé (QUA-06) depuis moins de FENETRE_LIVRABLE_SIGNE_JOURS jours, pour le directeur,
 * le chef de la mission ou qui modifie toutes les missions. La plateforme ne trace pas l'envoi
 * d'un livrable au client : la fenêtre borne le signalement.
 */
export const livrablesSignes: Extracteur = async (c) => {
  if (!a(c, "mission.lire")) return null;
  const r = await c.db.query(
    `SELECT s.id, s.mission_id, s.libelle, m.intitule, ${JOUR("s.modifie_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM qualite_suivis s JOIN missions m ON m.id = s.mission_id
     WHERE s.statut = 'signe' AND s.modifie_le >= $4::date - $5::int AND ${VISIBLE}
       AND ($3::boolean OR m.chef_id = $2 OR m.directeur_id = $2)
     ORDER BY s.modifie_le, s.id LIMIT $6`,
    [
      ...base(c),
      a(c, "mission.modifier_toutes"),
      c.date,
      FENETRE_LIVRABLE_SIGNE_JOURS,
      PLAFOND_PAR_SOURCE,
    ],
  );
  return enSource("envoyer", r.rows, (l) => ({
    type: "livrable_signe",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.libelle),
    mission_libelle: texte(l.intitule),
    lien: `/qualite/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

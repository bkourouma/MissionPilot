import { relancerFactureManuellement } from "../../../finance/relance-manuelle.js";
import type { CleMission, MissionLue } from "./casting.js";
import {
  BANQUES,
  ERREUR_SAISIE,
  FACTURATION,
  PARAMETRES_RELANCES,
  PLAN_COMPTABLE,
  RETARD,
  type FactureSpec,
  type PaiementSpec,
} from "./donnees-facturation.js";
import {
  acteur,
  appel,
  autreGestionnaire,
  cleGestionnaire,
  etape,
  lire,
  ouvre,
  part,
  plus,
  session,
  trouverFacture,
  type Env,
  type Evenement,
} from "./facturation-outils.js";

/*
 * ENCAISSEMENTS, RELANCES et CONTRE-PASSATION (FIN-09), plus les paramètres de finance du cabinet
 * (relances, plan comptable). Les montants des règlements sont lus sur la facture (net à payer) et
 * sur sa situation de paiement (solde calculé par le moteur) : rien n'est recalculé ici sauf
 * des parts, par le moteur de pourcentage. Les références (virement, chèque, Mobile Money) sont
 * fictives, uniques et tirées d'un flux à graine fixe. Une facture est « soldée » quand
 * ses règlements couvrent son net à payer ; le contrôle de clôture s'appuie sur cette situation.
 */

const PREFIXE_OPERATEUR = {
  orange_money: "OM",
  mtn_momo: "MOMO",
  wave: "WAVE",
  moov_money: "MOOV",
} as const;

function reference(
  env: Env,
  cle: CleMission,
  cleFacture: string,
  indice: number,
  p: PaiementSpec,
  date: string,
): string {
  const r = env.rng.deriver(`facturation|ref|${cle}|${cleFacture}|${indice}`);
  const aammjj = `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;
  if (p.mode === "cheque") return `CHQ-${r.entier(1_000_000, 9_999_999)}`;
  if (p.mode === "mobile_money") {
    const op = PREFIXE_OPERATEUR[p.operateur ?? "orange_money"];
    return `${op}${aammjj}.${r.entier(1000, 9999)}.${r.entier(100_000, 999_999)}`;
  }
  return `${r.choisir(BANQUES)}-VIR-${aammjj}-${r.entier(1000, 9999)}`;
}

/** Encaisse (route réelle) une part d'une facture émise, à la date fictive `date`. */
export async function encaisser(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  factureId: string,
  cleFacture: string,
  indice: number,
  date: string,
  p: PaiementSpec,
  referenceImposee?: string,
): Promise<void> {
  const ref = referenceImposee ?? reference(env, cle, cleFacture, indice, p, date);
  const deja = await lire(
    env,
    "SELECT 1 FROM encaissements WHERE cabinet_id = $1 AND reference = $2",
    [env.ctx.cabinetId, ref],
  );
  if (deja.length > 0) return;
  const g = session(env, cleGestionnaire(cle));
  const facture = await appel(200, "lecture de la facture", g.get(`/api/factures/${factureId}`));
  if (facture.statut !== "emise") return;
  const situation = await appel(
    200,
    "situation de paiement",
    g.get(`/api/factures/${factureId}/paiement`),
  );
  const solde = Number(situation.solde);
  if (solde <= 0) return;
  const montant =
    p.part === "reste" ? solde : Math.min(part(Number(facture.net_a_payer), p.part), solde);
  await etape(
    env,
    date,
    () =>
      appel(
        201,
        `encaissement ${ref}`,
        g.post("/api/finance/encaissements", {
          client_id: m.clientId,
          date,
          montant,
          devise: m.devise,
          mode: p.mode,
          operateur: p.mode === "mobile_money" ? (p.operateur ?? "orange_money") : null,
          reference: ref,
          commentaire: p.commentaire ?? null,
          imputations: [{ facture_id: factureId, montant }],
          avance: false,
        }),
      ),
    14,
  );
  env.compteurs.encaissements += 1;
}

/** Événements d'encaissement des factures d'une liste (délais de 15 à 60 jours après l'émission). */
export function evenementsPaiements(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  specs: readonly Pick<FactureSpec, "cle" | "date" | "objet" | "paiements">[],
): Evenement[] {
  const evenements: Evenement[] = [];
  for (const s of specs) {
    (s.paiements ?? []).forEach((p, i) => {
      const date = plus(env, ouvre(env, s.date), p.jours);
      if (date > env.ctx.aujourdhui) return;
      evenements.push({
        date,
        rang: 30,
        cle: `${cle}|paiement|${s.cle}|${i}`,
        jouer: async () => {
          const f = await trouverFacture(env, m, s.objet);
          if (!f || f.statut !== "emise") return;
          await encaisser(env, cle, m, f.id, s.cle, i, date, p);
        },
      });
    });
  }
  return evenements;
}

/* ----- Relances manuelles de la facture en retard ----- */

export function evenementsRelances(env: Env): Evenement[] {
  const m = env.casting.missions[RETARD.mission];
  const spec = FACTURATION[RETARD.mission]?.factures.find((f) => f.cle === RETARD.facture);
  if (!m || !spec) return [];
  return RETARD.relances.map((r) => {
    const date = ouvre(env, r.date);
    return {
      date,
      rang: 35,
      cle: `${RETARD.mission}|relance|${r.niveau}`,
      jouer: async () => {
        const f = await trouverFacture(env, m, spec.objet);
        if (!f || f.statut !== "emise") return;
        const deja = await lire(
          env,
          "SELECT 1 FROM relances_factures WHERE facture_id = $1 AND mode = 'manuelle' AND niveau = $2",
          [f.id, r.niveau],
        );
        if (deja.length > 0) return;
        const auth = acteur(env, cleGestionnaire(RETARD.mission), "gestionnaire");
        await etape(
          env,
          date,
          () =>
            env.ctx.database.withTenant(env.ctx.cabinetId, (db) =>
              relancerFactureManuellement(
                db,
                auth,
                f.id,
                { envoyer_email: false, niveau: r.niveau, message: r.message },
                date,
              ),
            ),
          15,
        );
        env.compteurs.relances += 1;
      },
    };
  });
}

/* ----- Encaissement erroné, contre-passation, ressaisie ----- */

export function evenementsErreurSaisie(env: Env): Evenement[] {
  const cle = ERREUR_SAISIE.mission;
  const m = env.casting.missions[cle];
  const spec = FACTURATION[cle]?.factures.find((f) => f.cle === ERREUR_SAISIE.facture);
  if (!m || !spec) return [];
  const jour = plus(env, ouvre(env, spec.date), 21);
  const refBanque = reference(
    env,
    cle,
    spec.cle,
    0,
    { jours: 21, part: "reste", mode: "virement" },
    jour,
  );
  const refErreur = `${refBanque}-S1`;
  const refJuste = `${refBanque}-S2`;
  const demandeur = cleGestionnaire(cle);
  const evt = (date: string, rang: number, nom: string, jouer: () => Promise<void>): Evenement => ({
    date,
    rang,
    cle: `${cle}|erreur-saisie|${nom}`,
    jouer,
  });
  const facture = async () => {
    const f = await trouverFacture(env, m, spec.objet);
    if (!f) throw new Error("Facture de l'encaissement erroné introuvable.");
    return f;
  };
  const demande = ouvre(env, ERREUR_SAISIE.demande);
  const validation = ouvre(env, ERREUR_SAISIE.validation);
  return [
    evt(jour, 30, "saisie", async () => {
      const f = await facture();
      await encaisser(
        env,
        cle,
        m,
        f.id,
        spec.cle,
        0,
        jour,
        {
          jours: 21,
          part: ERREUR_SAISIE.partErreur,
          mode: "virement",
          commentaire: "Virement reçu",
        },
        refErreur,
      );
    }),
    evt(demande, 31, "demande", async () => {
      const e = (
        await lire(env, "SELECT id FROM encaissements WHERE reference = $1 AND montant > 0", [
          refErreur,
        ])
      )[0];
      if (!e) return;
      const deja = await lire(env, "SELECT 1 FROM contre_passations WHERE encaissement_id = $1", [
        e.id,
      ]);
      if (deja.length > 0) return;
      await etape(
        env,
        demande,
        () =>
          appel(
            201,
            "demande de contre-passation",
            session(env, demandeur).post(
              `/api/finance/encaissements/${e.id as string}/contre-passation`,
              {
                motif: ERREUR_SAISIE.motif,
              },
            ),
          ),
        14,
      );
    }),
    evt(validation, 32, "validation", async () => {
      const d = (
        await lire(
          env,
          `SELECT c.id FROM contre_passations c JOIN encaissements e ON e.id = c.encaissement_id
            WHERE e.reference = $1 AND c.statut = 'demandee'`,
          [refErreur],
        )
      )[0];
      if (!d) return;
      await etape(
        env,
        validation,
        () =>
          appel(
            200,
            "validation de la contre-passation",
            session(env, autreGestionnaire(demandeur)).post(
              `/api/finance/contre-passations/${d.id as string}/valider`,
            ),
          ),
        14,
      );
      env.compteurs.contrePassations += 1;
    }),
    evt(validation, 33, "ressaisie", async () => {
      const f = await facture();
      await encaisser(
        env,
        cle,
        m,
        f.id,
        spec.cle,
        1,
        jour,
        {
          jours: 21,
          part: "reste",
          mode: "virement",
          commentaire: "Ressaisie du virement avec le bon montant",
        },
        refJuste,
      );
    }),
  ];
}

/* ----- Paramètres de finance du cabinet ----- */

/** Paramètres de relance et plan comptable (SYSCOHADA) du cabinet, validés par un associé. */
export async function parametresFinance(env: Env, date: string): Promise<void> {
  const gestionnaire = session(env, "gestionnaire");
  const id = env.ctx.cabinetId;
  if (
    (await lire(env, "SELECT 1 FROM parametres_relances WHERE cabinet_id = $1", [id])).length === 0
  ) {
    await etape(env, date, () =>
      appel(
        200,
        "paramètres de relance",
        gestionnaire.patch("/api/finance/parametres-relances", PARAMETRES_RELANCES),
      ),
    );
    await env.ctx.proprietaire.query(
      "UPDATE parametres_relances SET modifie_le = $2::timestamptz WHERE cabinet_id = $1",
      [id, `${date}T10:00:00Z`],
    );
  }
  if (
    (await lire(env, "SELECT 1 FROM plan_comptable_validation WHERE cabinet_id = $1", [id]))
      .length === 0
  ) {
    await etape(env, date, async () => {
      await appel(
        200,
        "plan comptable",
        gestionnaire.patch("/api/finance/plan-comptable", PLAN_COMPTABLE),
      );
      await appel(
        200,
        "validation du plan comptable",
        session(env, "associe").patch("/api/finance/plan-comptable", { valeurs_validees: true }),
      );
    });
    const horodatage = `${date}T11:00:00Z`;
    await env.ctx.proprietaire.query(
      "UPDATE plan_comptable_cabinet SET modifie_le = $2::timestamptz WHERE cabinet_id = $1",
      [id, horodatage],
    );
    await env.ctx.proprietaire.query(
      "UPDATE plan_comptable_validation SET modifie_le = $2::timestamptz WHERE cabinet_id = $1",
      [id, horodatage],
    );
  }
}

import type { Database, Db } from "../db/pool.js";
import { empreinte, type Trousseau } from "./chiffrement.js";

/**
 * Limiteur de tentatives PERSISTANT et PARTAGÉ entre instances : l'état vit en
 * base (`tentatives_auth`, migration 0120), accessible par les seules fonctions
 * SECURITY DEFINER `reserver_tentative_auth`, `liberer_tentatives_auth` et
 * `debloquer_tentatives_auth`. Il survit donc au redémarrage et vaut pour toutes
 * les instances de l'API.
 *
 * - Règles PAR ESPACE fixées en base (`tentatives_auth_regles`) : 10 tentatives
 *   par fenêtre GLISSANTE de 15 min pour `connexion`, `reauth` et `facteur`,
 *   1 000 000 de clés au plus par espace. L'appelant ne fournit ni plafond, ni
 *   fenêtre, ni capacité, ni horloge (horloge de la base ; réglage de test
 *   `app.horloge_test` honoré dans une base « _test » seulement).
 * - La tentative est réservée AVANT le calcul coûteux (hachage du mot de passe,
 *   vérification du code) : la réservation est atomique (ligne verrouillée), des
 *   requêtes simultanées ne peuvent pas dépasser le plafond.
 * - La clé est l'e-mail normalisé (minuscules, sans espaces autour), stocké en
 *   empreinte HMAC-SHA-256 à clé dérivée de TFA_MASTER_KEY (HKDF, usage
 *   « limiteur », version courante) : une fuite de la base seule ne permet pas de
 *   tester une adresse. En développement, la clé de développement de `config.ts`
 *   sert, comme pour la 2FA. Une rotation de TFA_MASTER_KEY change les
 *   empreintes : les compteurs en cours repartent de zéro (au plus une fenêtre).
 *   L'adresse IP n'est pas une clé : celle vue par l'API est celle du relais web,
 *   et X-Forwarded-For est falsifiable par le client.
 * - Taille bornée (constat F4, mineurs 1-2) : quand l'espace est plein, seules des
 *   clés EXPIRÉES ou peu utilisées (moins de la moitié du plafond dans la fenêtre)
 *   sont évincées, la plus ancienne d'abord ; si toutes sont protégées, la nouvelle
 *   clé est refusée. Saturer la table d'e-mails inventés ne vide pas le blocage
 *   d'une cible.
 * - Compromis accepté : un tiers qui connaît seulement l'e-mail peut bloquer la
 *   connexion de son titulaire tant qu'il insiste. Un gestionnaire du cabinet la
 *   débloque (`debloquer`, POST /api/cabinet/utilisateurs/:id/debloquer-connexion).
 *
 * `db` (facultatif) : transaction en cours de l'appelant. Sans elle, l'appel ouvre
 * sa propre courte transaction (`withoutTenant`). Un appelant qui détient déjà une
 * connexion (dans `withTenant`) DOIT la passer, pour ne pas attendre une seconde
 * connexion du pool (épuisement du pool sous charge) ; la réservation suit alors
 * le sort de sa transaction.
 */
export interface Limiteur {
  /** Réserve une tentative ; faux si le plafond de la fenêtre est atteint. */
  reserver(cle: string, db?: Db): Promise<boolean>;
  /** Efface le compteur (authentification réussie). */
  liberer(cle: string, db?: Db): Promise<void>;
  /** Efface le compteur sur décision d'un gestionnaire ; vrai si la clé était bloquée. */
  debloquer(cle: string, db?: Db): Promise<boolean>;
}

/** Espaces connus de la base (`tentatives_auth_regles`, migration 0120). */
export type EspaceLimiteur = "connexion" | "reauth" | "facteur";

/** Empreinte de la clé : e-mail normalisé, HMAC à clé dérivée, jamais stocké en clair. */
export function empreinteCle(trousseau: Trousseau, cle: string): string {
  return empreinte(trousseau, "limiteur", trousseau.versionActuelle, cle.trim().toLowerCase());
}

/**
 * @param espace nom du limiteur : deux limiteurs du même espace partagent leurs
 *   compteurs, quelle que soit l'instance.
 * @param trousseau trousseau de l'application (`trousseauDepuisConfig`).
 */
export function creerLimiteur(
  base: Database,
  espace: EspaceLimiteur,
  trousseau: Trousseau,
): Limiteur {
  const executer = <T>(db: Db | undefined, fn: (d: Db) => Promise<T>) =>
    db ? fn(db) : base.withoutTenant(fn);
  // `fonction` : l'une des trois fonctions SECURITY DEFINER (constante de code).
  const appeler = (
    fonction: "reserver_tentative_auth" | "liberer_tentatives_auth" | "debloquer_tentatives_auth",
    cle: string,
    db: Db | undefined,
  ) =>
    executer(db, async (d) => {
      const r = await d.query(`SELECT ${fonction}($1, $2) AS resultat`, [
        espace,
        empreinteCle(trousseau, cle),
      ]);
      return r.rows[0]?.resultat as unknown;
    });

  return {
    reserver: async (cle, db) => (await appeler("reserver_tentative_auth", cle, db)) === true,
    liberer: async (cle, db) => {
      await appeler("liberer_tentatives_auth", cle, db);
    },
    debloquer: async (cle, db) => (await appeler("debloquer_tentatives_auth", cle, db)) === true,
  };
}

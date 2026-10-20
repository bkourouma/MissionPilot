-- Plafond de débit du brief (AUT-07) : compteur PARTAGÉ entre instances, en base.
--
-- Jusqu'ici le plafond de GET /api/brief était tenu en mémoire (n instances : n fois le plafond,
-- remise à zéro au redémarrage). Il passe par le limiteur persistant (0120, 0544) : un espace de
-- plus, `brief_requetes`, règles fixées EN BASE :
-- - 60 requêtes par fenêtre glissante de 10 minutes et par utilisateur (clé : identifiant de
--   l'utilisateur, en empreinte HMAC) ; 100 000 clés au plus (valeurs à valider).
-- Cette migration porte un numéro supérieur à 0544 (0550) : la fonction est REDÉFINIE en entier et la
-- dernière définition appliquée l'emporte ; elle reprend À L'IDENTIQUE les cinq espaces de 0544.

CREATE OR REPLACE FUNCTION tentatives_auth_regles(
  p_espace text, OUT p_max int, OUT p_fenetre interval, OUT p_capacite int
) RETURNS record
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    CASE p_espace
      WHEN 'connexion' THEN -- mot de passe à la connexion (routes/auth.ts)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'reauth' THEN -- mot de passe redemandé (auth/confirmer-identite.ts)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'facteur' THEN -- tout code de second facteur (connexion, activation, confirmations)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'webhook_canal' THEN -- requêtes du webhook entrant, par compte (canaux/webhook.ts)
        p_max := 600; p_fenetre := interval '1 minute'; p_capacite := 100000;
      WHEN 'webhook_invalide' THEN -- signatures invalides du webhook (clé unique globale)
        p_max := 30; p_fenetre := interval '5 minutes'; p_capacite := 10;
      WHEN 'brief_requetes' THEN -- consultations du brief, par utilisateur (brief/debit.ts)
        p_max := 60; p_fenetre := interval '10 minutes'; p_capacite := 100000;
      ELSE
        RAISE EXCEPTION 'Espace du limiteur de tentatives inconnu.';
    END CASE;
  END $$;

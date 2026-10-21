"use client";

import type { FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Bouton } from "../../../../components/ui/Bouton";
import { chargeCache, explicationCache, messageCache, type EtatCacheIa } from "./routage-cache";
import { useEnregistrementIa } from "./useEnregistrementIa";

/**
 * Cache des réponses IA du cabinet (AGT-06), DÉSACTIVÉ par défaut. Le réglage ne change ni la
 * clé ni le plafond : aucune reconfirmation n'est jointe d'office (elle l'est si l'API la
 * demande). Le désactiver vide le cache du cabinet côté serveur.
 */
export function CacheIa({ etat }: { etat: EtatCacheIa }) {
  const e = useEnregistrementIa<never>();
  const [attente, marquer] = useAttenteRafraichissement(etat.actif);
  const activer = !etat.actif;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await e.enregistrer(
      { ok: true, charge: chargeCache(activer) },
      { succes: messageCache(activer) },
    );
    if (ok) marquer();
  }

  return (
    <form
      ref={e.f.refFormulaire}
      className="mp-formulaire"
      method="post"
      noValidate
      onSubmit={soumettre}
    >
      <RetourFormulaire erreur={e.f.erreurGlobale} succes={e.f.succes} refAlerte={e.f.refAlerte} />
      <p className="mp-texte-petit">{explicationCache(etat)}</p>
      {e.confirmation ? (
        <ChampsReconfirmation
          saisie={e.confirmation}
          onChange={e.setConfirmation}
          erreurs={e.f.erreurs}
          motif={
            activer ? "activer le cache des réponses IA" : "désactiver le cache des réponses IA"
          }
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={activer ? "primaire" : "secondaire"}
          chargement={e.f.enCours || attente}
          texteChargement="Enregistrement…"
        >
          {activer ? "Activer le cache" : "Désactiver et vider le cache"}
        </Bouton>
      </div>
    </form>
  );
}

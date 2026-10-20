import { BandeauSimule } from "../canaux/BandeauSimule";
import { Alerte } from "../ui/Alerte";
import { AVERTISSEMENT_SIGNATURE_SIMULEE } from "../../lib/signatures";

/**
 * Avertissement fixe de tout écran de signature : « Signature simulée : sans valeur juridique »,
 * avec le bandeau « Simulé : aucun envoi réel ». Le fournisseur est local, niveau « simple simulée ».
 */
export function AvertissementSignature() {
  return (
    <div className="mp-pile">
      <Alerte tonalite="attention" annonce="aucune" titre={AVERTISSEMENT_SIGNATURE_SIMULEE}>
        <p>
          La signature se fait dans MissionPilot, après reconfirmation de votre identité. Elle ne
          remplace ni une signature électronique qualifiée ni une signature manuscrite, et elle
          n&apos;a aucun effet sur le budget ni sur le statut de la mission.
        </p>
      </Alerte>
      <BandeauSimule>
        <p>Aucun fournisseur de signature externe n&apos;est contacté.</p>
      </BandeauSimule>
    </div>
  );
}

import { BandeauSimule } from "../canaux/BandeauSimule";
import { Alerte } from "../ui/Alerte";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { avertissementSignatureSimulee } from "../../lib/signatures";

/**
 * Avertissement fixe de tout écran de signature : « Signature simulée : sans valeur juridique »,
 * avec le bandeau « Simulé : aucun envoi réel ». Le fournisseur est local, niveau « simple simulée ».
 */
export async function AvertissementSignature() {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-pile">
      <Alerte tonalite="attention" annonce="aucune" titre={avertissementSignatureSimulee(langue)}>
        <p>
          {t(
            "La signature se fait dans CabinetPilot, après reconfirmation de votre identité. Elle ne remplace ni une signature électronique qualifiée ni une signature manuscrite, et elle n'a aucun effet sur le budget ni sur le statut de la mission.",
            "Signing takes place in CabinetPilot, after your identity is reconfirmed. It replaces neither a qualified electronic signature nor a handwritten signature, and it has no effect on the budget or on the engagement status.",
          )}
        </p>
      </Alerte>
      <BandeauSimule>
        <p>
          {t(
            "Aucun fournisseur de signature externe n'est contacté.",
            "No external signature provider is contacted.",
          )}
        </p>
      </BandeauSimule>
    </div>
  );
}
